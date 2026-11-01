package com.phage.syrinx;

import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Loopback HTTP server for the WebView UI.
 *
 * The UI runs on http://127.0.0.1:port/ so every request is same-origin. API
 * calls go to /api/... and are signed + forwarded to the NAS here, which keeps
 * the session token out of JavaScript and sidesteps CORS entirely. Media
 * requests are streamed straight through, Range headers included.
 */
final class ProxyServer {
    private static final String TAG = "SyrinxProxy";

    // WebView keys localStorage by origin, port included. A stable port keeps the
    // saved queue/position across restarts; if it is taken we fall back to any.
    private static final int PREFERRED_PORT = 42755;

    private final Prefs prefs;
    private final AssetManager assets;
    private final ServerSocket server;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile boolean running = true;

    ProxyServer(Prefs prefs, AssetManager assets) throws IOException {
        this.prefs = prefs;
        this.assets = assets;
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        ServerSocket sock;
        try {
            sock = new ServerSocket(PREFERRED_PORT, 50, loopback);
        } catch (IOException e) {
            Log.w(TAG, "port " + PREFERRED_PORT + " busy, using a random one");
            sock = new ServerSocket(0, 50, loopback);
        }
        this.server = sock;
    }

    int port() {
        return server.getLocalPort();
    }

    void start() {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "fn-proxy");
        t.setDaemon(true);
        t.start();
    }

    void stop() {
        running = false;
        try {
            server.close();
        } catch (IOException ignored) {
        }
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = server.accept();
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        handle(s);
                    }
                });
            } catch (IOException e) {
                if (running) Log.w(TAG, "accept failed", e);
            }
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(60000);
            InputStream rawIn = socket.getInputStream();
            BufferedInputStream in = new BufferedInputStream(rawIn);
            OutputStream out = new BufferedOutputStream(socket.getOutputStream(), 32 * 1024);

            String requestLine = readLine(in);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0].toUpperCase(Locale.US);
            String target = parts[1];

            Map<String, String> headers = readHeaders(in);
            byte[] body = readBody(in, headers);

            String path = target;
            String query = "";
            int q = target.indexOf('?');
            if (q >= 0) {
                path = target.substring(0, q);
                query = target.substring(q + 1);
            }

            if ("OPTIONS".equals(method)) {
                writeSimple(out, 204, "text/plain", new byte[0], null);
                return;
            }

            if ("/_status".equals(path)) {
                handleStatus(out);
            } else if ("/_login".equals(path)) {
                handleLogin(out, body);
            } else if ("/_logout".equals(path)) {
                prefs.setToken("");
                prefs.setUserJson("");
                writeJson(out, 200, "{\"ok\":true}");
            } else if ("/_config".equals(path)) {
                handleConfig(out, body);
            } else if (path.startsWith("/api/")) {
                proxyApi(out, method, path.substring(5), query, headers, body);
            } else {
                serveStatic(out, path);
            }
            out.flush();
        } catch (Exception e) {
            Log.w(TAG, "request failed", e);
        } finally {
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    // ---------- control endpoints ----------

    private void handleStatus(OutputStream out) throws IOException {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("host", prefs.host());
            o.put("loggedIn", !prefs.token().isEmpty());
            String u = prefs.userJson();
            o.put("user", u.isEmpty() ? null : new JSONObject(u));
        } catch (Exception e) {
            Log.w(TAG, "status", e);
        }
        writeJson(out, 200, o.toString());
    }

    private void handleConfig(OutputStream out, byte[] body) throws IOException {
        JSONObject res = new JSONObject();
        try {
            JSONObject req = new JSONObject(new String(body, "UTF-8"));
            String host = Prefs.normalizeHost(req.optString("host", ""));
            if (!host.isEmpty()) prefs.setHost(host);
            res.put("ok", true);
            res.put("host", prefs.host());
        } catch (Exception e) {
            try {
                res.put("ok", false);
                res.put("msg", String.valueOf(e.getMessage()));
            } catch (Exception ignored) {
            }
        }
        writeJson(out, 200, res.toString());
    }

    private void handleLogin(OutputStream out, byte[] body) throws IOException {
        JSONObject res = new JSONObject();
        HttpURLConnection conn = null;
        try {
            JSONObject req = new JSONObject(new String(body, "UTF-8"));
            String host = Prefs.normalizeHost(req.optString("host", prefs.host()));
            if (host.isEmpty()) throw new IOException("服务器地址为空");
            prefs.setHost(host);
            String username = req.optString("username", "").trim();
            String password = req.optString("password", "");
            if (username.isEmpty()) throw new IOException("请输入用户名");

            JSONObject payload = new JSONObject();
            payload.put("username", username);
            payload.put("password", Api.sha256(password));
            payload.put("deviceId", prefs.deviceId());
            byte[] payloadBytes = payload.toString().getBytes("UTF-8");

            String path = Api.PREFIX + "/user/password-login";
            conn = (HttpURLConnection) new URL(host + path).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("authx", Api.signHeader("POST", path, "", payloadBytes));
            OutputStream os = conn.getOutputStream();
            os.write(payloadBytes);
            os.close();

            int status = conn.getResponseCode();
            InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = new String(readAll(is), "UTF-8");
            JSONObject env = new JSONObject(text);
            int code = env.optInt("code", -1);
            if (status >= 400 || code != 0) {
                res.put("ok", false);
                res.put("msg", env.optString("msg", "登录失败 (HTTP " + status + ")"));
            } else {
                JSONObject data = env.optJSONObject("data");
                String token = data == null ? "" : data.optString("userToken", "");
                if (token.isEmpty()) {
                    res.put("ok", false);
                    res.put("msg", "服务器没有返回登录凭证");
                } else {
                    prefs.setToken(token);
                    JSONObject user = data.optJSONObject("user");
                    prefs.setUserJson(user == null ? "" : user.toString());
                    res.put("ok", true);
                    res.put("user", user == null ? JSONObject.NULL : user);
                }
            }
        } catch (Exception e) {
            try {
                res.put("ok", false);
                res.put("msg", messageOf(e));
            } catch (Exception ignored) {
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
        writeJson(out, 200, res.toString());
    }

    private static String messageOf(Exception e) {
        String m = e.getMessage();
        if (m == null || m.isEmpty()) m = e.getClass().getSimpleName();
        if (m.contains("Failed to connect") || m.contains("failed to connect")
                || m.contains("Connection refused") || m.contains("ECONNREFUSED")) {
            return "无法连接服务器，请检查地址和网络";
        }
        if (m.contains("timed out") || m.contains("timeout")) return "连接超时，请检查服务器地址";
        return m;
    }

    // ---------- api proxy ----------

    private void proxyApi(OutputStream out, String method, String subPath, String query,
                          Map<String, String> headers, byte[] body) throws IOException {
        String host = prefs.host();
        String path = Api.PREFIX + "/" + subPath;
        String url = host + path + (query.isEmpty() ? "" : "?" + query);

        boolean media = path.endsWith("/track/stream");
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(media ? 0 : 30000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("authx", Api.signHeader(method, path, query, body));
            String token = prefs.token();
            if (!token.isEmpty()) conn.setRequestProperty("Cookie", "music-token=" + token);
            String range = header(headers, "range");
            if (range != null) conn.setRequestProperty("Range", range);
            String accept = header(headers, "accept");
            if (accept != null) conn.setRequestProperty("Accept", accept);
            if (body != null && body.length > 0) {
                conn.setDoOutput(true);
                String ct = header(headers, "content-type");
                conn.setRequestProperty("Content-Type", ct == null ? "application/json" : ct);
                OutputStream os = conn.getOutputStream();
                os.write(body);
                os.close();
            }

            int status = conn.getResponseCode();
            InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();

            StringBuilder head = new StringBuilder();
            head.append("HTTP/1.1 ").append(status).append(' ')
                    .append(statusText(status)).append("\r\n");
            copyHeader(conn, head, "Content-Type");
            copyHeader(conn, head, "Content-Length");
            copyHeader(conn, head, "Content-Range");
            copyHeader(conn, head, "Accept-Ranges");
            copyHeader(conn, head, "Cache-Control");
            copyHeader(conn, head, "ETag");
            copyHeader(conn, head, "Last-Modified");
            head.append("Access-Control-Allow-Origin: *\r\n");
            head.append("Connection: close\r\n\r\n");
            out.write(head.toString().getBytes("UTF-8"));
            if (is != null) copyStream(is, out);
            out.flush();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void copyHeader(HttpURLConnection conn, StringBuilder head, String name) {
        String v = conn.getHeaderField(name);
        if (v != null) {
            head.append(name).append(": ").append(v).append("\r\n");
        }
    }

    // ---------- static assets ----------

    private void serveStatic(OutputStream out, String path) throws IOException {
        String p = path;
        if (p.isEmpty() || "/".equals(p)) p = "/index.html";
        if (p.contains("..")) {
            writeSimple(out, 403, "text/plain", "forbidden".getBytes("UTF-8"), null);
            return;
        }
        String asset = p.startsWith("/") ? p.substring(1) : p;
        byte[] bytes;
        try {
            bytes = readAsset(asset);
        } catch (IOException e) {
            if (!p.endsWith(".html")) {
                writeSimple(out, 404, "text/plain", "not found".getBytes("UTF-8"), null);
                return;
            }
            bytes = readAsset("index.html");
        }
        String mime = mimeOf(asset);
        Map<String, String> extra = new HashMap<>();
        extra.put("Cache-Control", "no-cache");
        writeSimple(out, 200, mime, bytes, extra);
    }

    private byte[] readAsset(String name) throws IOException {
        InputStream is = assets.open(name);
        try {
            return readAllBytes(is);
        } finally {
            is.close();
        }
    }

    // ---------- http helpers ----------

    private static void writeJson(OutputStream out, int status, String json) throws IOException {
        Map<String, String> extra = new HashMap<>();
        extra.put("Cache-Control", "no-store");
        writeSimple(out, status, "application/json; charset=utf-8", json.getBytes("UTF-8"), extra);
    }

    private static void writeSimple(OutputStream out, int status, String mime, byte[] body,
                                    Map<String, String> extra) throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append(' ').append(statusText(status)).append("\r\n");
        head.append("Content-Type: ").append(mime).append("\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        if (extra != null) {
            for (Map.Entry<String, String> e : extra.entrySet()) {
                head.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            }
        }
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Connection: close\r\n\r\n");
        out.write(head.toString().getBytes("UTF-8"));
        out.write(body);
        out.flush();
    }

    private static String statusText(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 206: return "Partial Content";
            case 301: return "Moved Permanently";
            case 302: return "Found";
            case 304: return "Not Modified";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 500: return "Internal Server Error";
            default: return "Status";
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
        }
        if (c == -1 && b.size() == 0) return null;
        return new String(b.toByteArray(), "UTF-8");
    }

    private static Map<String, String> readHeaders(InputStream in) throws IOException {
        Map<String, String> m = new LinkedHashMap<>();
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            int i = line.indexOf(':');
            if (i <= 0) continue;
            m.put(line.substring(0, i).trim().toLowerCase(Locale.US), line.substring(i + 1).trim());
        }
        return m;
    }

    private static byte[] readBody(InputStream in, Map<String, String> headers) throws IOException {
        String te = headers.get("transfer-encoding");
        if (te != null && te.toLowerCase(Locale.US).contains("chunked")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            while (true) {
                String sizeLine = readLine(in);
                if (sizeLine == null) break;
                int semi = sizeLine.indexOf(';');
                if (semi >= 0) sizeLine = sizeLine.substring(0, semi);
                int size = Integer.parseInt(sizeLine.trim(), 16);
                if (size == 0) {
                    readLine(in);
                    break;
                }
                byte[] chunk = new byte[size];
                int off = 0;
                while (off < size) {
                    int n = in.read(chunk, off, size - off);
                    if (n < 0) break;
                    off += n;
                }
                out.write(chunk, 0, off);
                readLine(in);
            }
            return out.toByteArray();
        }
        String len = headers.get("content-length");
        if (len == null) return new byte[0];
        int n = Integer.parseInt(len.trim());
        byte[] buf = new byte[n];
        int off = 0;
        while (off < n) {
            int r = in.read(buf, off, n - off);
            if (r < 0) break;
            off += r;
        }
        return buf;
    }

    private static String header(Map<String, String> headers, String name) {
        return headers.get(name.toLowerCase(Locale.US));
    }

    private static void copyStream(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[32 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            out.flush();
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        if (in == null) return new byte[0];
        return readAllBytes(in);
    }

    private static byte[] readAllBytes(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase(Locale.US);
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".json")) return "application/json; charset=utf-8";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }
}

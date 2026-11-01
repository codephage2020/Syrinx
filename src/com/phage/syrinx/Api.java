package com.phage.syrinx;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/** fnOS music API signing helpers (mirrors the web client's fetch-client hooks). */
final class Api {
    static final String PREFIX = "/music/api/v1";

    private static final String SALT = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh";
    private static final String KEY = buildKey();
    private static final Random RND = new Random();

    private Api() {}

    private static String buildKey() {
        int[] b = {
            143, 253, 140, 143, 137, 139, 253, 141, 148, 248, 138, 141, 139,
            148, 141, 142, 128, 128, 148, 248, 137, 255, 137, 148, 251, 251,
            142, 128, 140, 252, 142, 136, 143, 142, 253, 137
        };
        StringBuilder sb = new StringBuilder(b.length);
        for (int v : b) sb.append((char) (v ^ 185));
        return sb.toString();
    }

    static String md5(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(32);
            for (byte x : d) {
                int v = x & 0xff;
                if (v < 16) sb.append('0');
                sb.append(Integer.toHexString(v));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    static String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(64);
            for (byte x : d) {
                int v = x & 0xff;
                if (v < 16) sb.append('0');
                sb.append(Integer.toHexString(v));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    /**
     * The server verifies a signature over the decoded, key-sorted query string.
     * The web client round-trips params through URLSearchParams and does a final
     * percent-decode before hashing, which is equivalent to hashing the decoded
     * "k=v&k=v" string.
     */
    static String canonicalQuery(String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) return "";
        Map<String, String> m = new LinkedHashMap<>();
        for (String pair : rawQuery.split("&")) {
            if (pair.isEmpty()) continue;
            int i = pair.indexOf('=');
            String k = i < 0 ? pair : pair.substring(0, i);
            String v = i < 0 ? "" : pair.substring(i + 1);
            m.put(dec(k), dec(v));
        }
        List<String> keys = new ArrayList<>(m.keySet());
        Collections.sort(keys);
        StringBuilder sb = new StringBuilder();
        for (String k : keys) {
            if (sb.length() > 0) sb.append('&');
            sb.append(k).append('=').append(m.get(k));
        }
        return sb.toString();
    }

    private static String dec(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (UnsupportedEncodingException | IllegalArgumentException e) {
            return s;
        }
    }

    /** authx header value for one request. */
    static String signHeader(String method, String path, String rawQuery, byte[] body) {
        String payloadHash;
        if ("GET".equalsIgnoreCase(method)) {
            payloadHash = md5(canonicalQuery(rawQuery));
        } else {
            String b = "";
            if (body != null && body.length > 0) {
                try {
                    b = new String(body, "UTF-8");
                } catch (UnsupportedEncodingException ignored) {
                }
            }
            payloadHash = md5(b);
        }
        String nonce = String.valueOf(100000 + RND.nextInt(900000));
        String ts = String.valueOf(System.currentTimeMillis());
        String sign = md5(SALT + "_" + path + "_" + nonce + "_" + ts + "_" + payloadHash + "_" + KEY);
        return "nonce=" + nonce + "&timestamp=" + ts + "&sign=" + sign;
    }
}

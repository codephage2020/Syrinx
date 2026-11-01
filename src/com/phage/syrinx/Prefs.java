package com.phage.syrinx;

import android.content.Context;
import android.content.SharedPreferences;

import java.security.SecureRandom;

final class Prefs {
    private static final String NAME = "syrinx";

    private final SharedPreferences sp;

    Prefs(Context ctx) {
        sp = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    String host() {
        // No default: the first launch shows the login screen and asks for one.
        return sp.getString("host", "");
    }

    void setHost(String host) {
        sp.edit().putString("host", normalizeHost(host)).apply();
    }

    String token() {
        return sp.getString("token", "");
    }

    void setToken(String t) {
        sp.edit().putString("token", t == null ? "" : t).apply();
    }

    String userJson() {
        return sp.getString("user", "");
    }

    void setUserJson(String j) {
        sp.edit().putString("user", j == null ? "" : j).apply();
    }

    String deviceId() {
        String d = sp.getString("deviceId", "");
        if (d.length() == 32) return d;
        byte[] r = new byte[16];
        new SecureRandom().nextBytes(r);
        StringBuilder sb = new StringBuilder(32);
        for (byte b : r) {
            int v = b & 0xff;
            if (v < 16) sb.append('0');
            sb.append(Integer.toHexString(v));
        }
        d = sb.toString();
        sp.edit().putString("deviceId", d).apply();
        return d;
    }

    static String normalizeHost(String h) {
        String s = h == null ? "" : h.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        if (s.isEmpty()) return s;
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        return s;
    }
}

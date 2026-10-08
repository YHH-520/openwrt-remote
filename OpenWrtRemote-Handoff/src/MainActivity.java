package com.owr.remote;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.RouteInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.NetworkInterface;
import java.net.InetAddress;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView web;                 // App 自己的界面（index.html）
    private FrameLayout root;

    /* ---------- 「路由器原生页面」覆盖层 ----------
       路由器自带页面（LuCI / iStore / 插件表单 / 网页终端）必须放在一个**顶层** WebView 里，
       因为 LuCI 的 sysauth_http cookie 是 SameSite=strict，
       从 file:// 页面用 iframe / fetch 根本带不上去；而整页跳走又会丢掉 App 自己的界面。

       覆盖层没有铺满全屏，而是**只占内容区**：上面留出 App 标题栏的高度、
       下面留出底部 Tab 栏的高度。留白区是几个不可点击的空 View，
       触摸事件会穿透到底下的 App WebView，于是「返回 / 刷新 / 切 Tab」
       这些按钮照常可用 —— 用户不用离开 App 就能切回其它页面。

       每个页面按 id 缓存一个 WebView：再次进入只是把旧的显示出来，
       不重新加载，省掉 LuCI 那几秒的白屏。 */
    private FrameLayout webHost;
    private LinearLayout webColumn;
    private View topGap, bottomGap;
    private FrameLayout webSlot;
    private ProgressBar webBar;
    private final LinkedHashMap<String, WebView> webCache = new LinkedHashMap<String, WebView>();
    private String currentWebId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        applyImmersive();

        WebView.setWebContentsDebuggingEnabled(true);

        // 用 FrameLayout 包裹，保证 WebView 始终 MATCH_PARENT（避免被 insets/aspect 约束）
        root = new FrameLayout(this);
        // 冷启动时 WebView 还没绘出第一帧，先铺上品牌渐变，
        // 和网页里那个启动动画同一套底色 —— 从点图标到主界面中间不闪黑。
        root.setBackground(brandBackground());
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // 不消费任何窗口 insets，让 WebView 铺满整窗
        root.setFitsSystemWindows(false);

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        web.setFitsSystemWindows(false);
        web.setBackground(brandBackground());
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // ↓↓↓ 关键修复：默认 useWideViewPort=false 会让 WebView 直接忽略 <meta viewport>，
        // 从而按内部兜底视口(320px)布局，导致 dpr/缓冲区尺寸全错、画面只渲染左上角一块。
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 26) {
            s.setSafeBrowsingEnabled(false);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new TailscaleBridge(), "TailscaleBridge");
        web.addJavascriptInterface(new MetricsBridge(), "AndroidBridge");
        web.addJavascriptInterface(new OwrNative(), "OwrNative");

        buildWebHost();

        root.addView(web);
        root.addView(webHost);
        setContentView(root);
        web.loadUrl("file:///android_asset/www/index.html");
    }

    /* ================= 覆盖层骨架 ================= */

    private void buildWebHost() {
        webHost = new FrameLayout(this);
        webHost.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // ★ 必须是**透明**的。
        // 这层铺满全屏，只有中间那块 webSlot 是路由器页面，上下两个 gap 是留白区。
        // 留白区一旦有不透明底色（之前是白色），就会把下面的 App 界面整个盖掉 ——
        // 现象就是「打开原生页面后顶栏变成一条纯白、返回和刷新都不见了」。
        // 透明之后，留白处透出的是 App 自己的 WebView，
        // 于是标题栏、返回键、底部 Tab 栏照常显示、照常可点。
        webHost.setBackgroundColor(Color.TRANSPARENT);
        webHost.setVisibility(View.GONE);
        // 容器本身绝不消费触摸：空白区要让事件落到下面的 App WebView 上
        webHost.setClickable(false);
        webHost.setFocusable(false);

        webColumn = new LinearLayout(this);
        webColumn.setOrientation(LinearLayout.VERTICAL);
        webColumn.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webColumn.setClickable(false);
        webColumn.setFocusable(false);

        topGap = new View(this);
        topGap.setClickable(false);
        topGap.setFocusable(false);
        bottomGap = new View(this);
        bottomGap.setClickable(false);
        bottomGap.setFocusable(false);

        webSlot = new FrameLayout(this);
        webSlot.setClickable(false);
        webSlot.setFocusable(false);

        // 上留白（= App 标题栏高度，含状态栏/挖孔避让）/ 页面槽（占满剩余）/ 下留白（= Tab 栏高度）
        webColumn.addView(topGap, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0));
        webColumn.addView(webSlot, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        webColumn.addView(bottomGap, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0));

        webHost.addView(webColumn);

        // 顶部细进度条：贴在页面槽的最上方，正好接在 App 标题栏下面
        webBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        FrameLayout.LayoutParams blp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        blp.gravity = Gravity.TOP;
        webBar.setLayoutParams(blp);
        webBar.setMax(100);
        webBar.setVisibility(View.GONE);
        webSlot.addView(webBar);
    }

    /** 页面侧用设备像素报上「内容区上下边界」，这里换算成两个留白的高度。 */
    private void applyWebInsets(int topPx, int bottomPx) {
        if (webColumn == null) return;
        LinearLayout.LayoutParams a = (LinearLayout.LayoutParams) topGap.getLayoutParams();
        if (a.height != topPx) { a.height = Math.max(0, topPx); topGap.setLayoutParams(a); }
        LinearLayout.LayoutParams b = (LinearLayout.LayoutParams) bottomGap.getLayoutParams();
        if (b.height != bottomPx) { b.height = Math.max(0, bottomPx); bottomGap.setLayoutParams(b); }
    }

    /* ================= 路由器页面 WebView ================= */

    private WebView newRouterWeb(final String user, final String pass) {
        WebView w = new WebView(this);
        w.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        w.setFitsSystemWindows(false);
        w.setBackgroundColor(Color.WHITE);
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        w.setVisibility(View.GONE);

        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // 路由器页面走缓存：LuCI 的静态资源每次都重下很慢
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);
        if (Build.VERSION.SDK_INT >= 29) s.setForceDark(WebSettings.FORCE_DARK_OFF);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);

        w.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView v, String u) {
                if (u == null) return;
                // LuCI 登录表单：自动填一次，填完就提交，用户无感
                if (u.contains("/cgi-bin/luci") && !u.contains("/admin/")
                        && user != null && !user.isEmpty() && pass != null && !pass.isEmpty()) {
                    v.evaluateJavascript(luciLoginJs(user, pass), null);
                }
                // ttyd 终端：等它把 login/password 提示打出来再喂凭据
                if (u.contains(":7681") || u.contains("ttyd")) {
                    v.evaluateJavascript(ttydLoginJs(user, pass), null);
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                try {
                    Uri uri = req.getUrl();
                    // ttyd 的入口页：把它的 WebGL 渲染器换成 DOM，见方法内注释
                    if (uri != null && uri.getPort() == 7681 && "/".equals(uri.getPath())) {
                        WebResourceResponse r = ttydPatched(uri.toString());
                        if (r != null) return r;
                    }
                } catch (Throwable ignored) {}
                return super.shouldInterceptRequest(v, req);
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int p) {
                if (v != currentWebView() || webBar == null) return;
                webBar.setProgress(p);
                webBar.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        return w;
    }

    private WebView currentWebView() {
        return currentWebId == null ? null : webCache.get(currentWebId);
    }

    private void showWeb(String id, String url, String title, String user, String pass,
                         int topPx, int bottomPx) {
        if (id == null || url == null) return;
        applyWebInsets(topPx, bottomPx);

        WebView target = webCache.get(id);
        if (target == null) {
            target = newRouterWeb(user, pass);
            webCache.put(id, target);
            webSlot.addView(target);
            if (webBar != null) webBar.bringToFront();
            target.loadUrl(url);
        } else {
            target.setVisibility(View.VISIBLE);
        }

        // 只显示当前这一个，其余缓存起来的页面保持后台状态（DOM/滚动位置都留着）
        for (Map.Entry<String, WebView> e : webCache.entrySet()) {
            e.getValue().setVisibility(e.getKey().equals(id) ? View.VISIBLE : View.GONE);
        }
        currentWebId = id;
        webHost.setVisibility(View.VISIBLE);
        webHost.bringToFront();
    }

    private void hideWeb() {
        if (webHost != null) webHost.setVisibility(View.GONE);
        if (webBar != null) webBar.setVisibility(View.GONE);
        for (WebView w : webCache.values()) w.setVisibility(View.GONE);
    }

    /** 切连接 / 重登时凭据可能变了，缓存里的自动填充逻辑就过期了，直接清干净 */
    private void clearWebCache() {
        for (WebView w : webCache.values()) {
            try { webSlot.removeView(w); w.destroy(); } catch (Throwable ignored) {}
        }
        webCache.clear();
        currentWebId = null;
    }

    /* ================= ttyd 渲染器补丁 =================
       实测：这台机器上 ttyd（xterm.js）默认用 WebGL 渲染器，WebGL 上下文能建起来、
       后端也确实把 "OpenWrt login: " 推下来了（读 xterm 缓冲区能看到），
       但屏幕上（以及 screencap / CDP 截图里）整块终端都是空的。
       它自己的偏好设置是服务端通过 WebSocket 的 '2' 号消息下发的（内容恰好是 "2{ }"），
       所以在页面脚本之前拦一层，把 rendererType 改成 dom —— 纯 DOM 文本，
       不依赖 GPU 合成，Safari/WebView 上一直是 ttyd 的兜底方案。 */
    private static final String TTYD_PATCH =
        "<script>(function(){try{"
      + "var _add=WebSocket.prototype.addEventListener;"
      + "WebSocket.prototype.addEventListener=function(t,f,o){"
      + "if(t!=='message'||typeof f!=='function')return _add.call(this,t,f,o);"
      + "var w=function(ev){try{var d=ev.data;"
      + "if(d&&d.byteLength!==undefined){var b=new Uint8Array(d.buffer||d);"
      + "if(b[0]===0x32){var j=JSON.parse(new TextDecoder().decode(b.subarray(1)));"
      + "j.rendererType='dom';"
      + "var n=new TextEncoder().encode(JSON.stringify(j));"
      + "var out=new Uint8Array(n.length+1);out[0]=0x32;out.set(n,1);"
      + "return f.call(this,new MessageEvent('message',{data:out.buffer}));}}}catch(e){}"
      + "return f.call(this,ev);};return _add.call(this,t,w,o);};"
      + "console.log('[owr] ttyd renderer -> dom');"
      + "}catch(e){}})();</script>";

    private WebResourceResponse ttydPatched(String url) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(12000);
            c.setRequestProperty("User-Agent", "OWR");
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                bo.write(buf, 0, n);
                if (bo.size() > 4 * 1024 * 1024) break;
            }
            in.close();
            String html = new String(bo.toByteArray(), "UTF-8");
            int at = html.indexOf("<head>");
            if (at >= 0) at += 6;
            else {
                at = html.indexOf("<html>");
                at = at >= 0 ? at + 6 : 0;
            }
            String out = html.substring(0, at) + TTYD_PATCH + html.substring(at);
            Map<String, String> hdr = new HashMap<String, String>();
            hdr.put("Cache-Control", "no-store");
            return new WebResourceResponse("text/html", "utf-8", 200, "OK", hdr,
                    new ByteArrayInputStream(out.getBytes("UTF-8")));
        } catch (Throwable t) {
            return null;   // 打补丁失败就走正常加载，别把页面搞挂
        }
    }

    private static String jsStr(String s) {
        if (s == null) return "\"\"";
        return JSONObject.quote(s);
    }

    /** LuCI 登录页自动填充 */
    private static String luciLoginJs(String user, String pass) {
        return "(function(){try{"
             + "var f=document.querySelector('form[action*=\"cgi-bin/luci\"]')||document.querySelector('form');"
             + "if(!f)return;"
             + "var U=document.querySelector('input[name=\"luci_username\"],#luci_username')||"
             + "      document.querySelector('input[name=\"username\"],#username');"
             + "var P=document.querySelector('input[name=\"luci_password\"],#luci_password')||"
             + "      document.querySelector('input[name=\"password\"],#password');"
             + "if(U&&P){U.value=" + jsStr(user) + ";P.value=" + jsStr(pass) + ";f.submit();}"
             + "}catch(e){}})();";
    }

    /** ttyd 终端自动登录：轮询 xterm 缓冲区，看到哪个提示就回哪个凭据。
        做成「看到提示才输」而不是「打开就盲输」，这样即使以后 ttyd 开了 -W（免登录）
        也不会往 shell 里乱敲东西。 */
    private static String ttydLoginJs(String user, String pass) {
        if (user == null || user.isEmpty() || pass == null || pass.isEmpty()) return "";
        return "(function(){try{"
             + "if(window.__owrLogin)return;window.__owrLogin=1;"
             + "var step=0,n=0;"
             + "var t=setInterval(function(){"
             + "  if(++n>80){clearInterval(t);return;}"
             + "  try{"
             + "    var m=window.term;if(!m||!m.buffer||!m.buffer.active)return;"
             + "    var b=m.buffer.active,s='';"
             + "    for(var i=0;i<b.length;i++){var l=b.getLine(i);if(l)s+=l.translateToString(true)+'\\n';}"
             + "    if(step===0&&/login:\\s*$/m.test(s)){m.paste(" + jsStr(user) + "+'\\r');step=1;}"
             + "    else if(step===1&&/Password:\\s*$/m.test(s)){m.paste(" + jsStr(pass) + "+'\\r');step=2;clearInterval(t);}"
             + "  }catch(e){}"
             + "},350);"
             + "}catch(e){}})();";
    }

    /* ================= LuCI 菜单抓取 =================
       路由器的「服务 / NAS / VPN / 统计」这些页面路径随固件和已装插件变化，
       硬编码一定会漏。好在 LuCI 自己有一个接口能给出完整菜单树：
         GET /cgi-bin/luci/admin/menu            -> 菜单树 JSON
         GET /cgi-bin/luci/admin/translations/<lang> -> 翻译表 window.TR={ "<hash>": "译文" }
           （zh-cn 是中文；英文不需要，源字符串就是英文）
       菜单里的标题是**未翻译的源字符串**，主题是靠 cbi.js 里的 sfh() 哈希查表的。
       这里把 sfh 照搬过来，在原生侧查好中文再交给页面 ——
       于是同一份 APK 换到任意路由器上，菜单结构和语言都能自适应。 */
    private volatile String luciCookie;

    private void fetchLuciData(final String base, final String user, final String pass,
                               final String trLang) {
        new Thread(new Runnable() {
            public void run() {
                String out = "";
                try {
                    if (luciCookie == null) luciCookie = luciLogin(base, user, pass);
                    String menu = luciCookie == null ? null : httpGet(base + "/cgi-bin/luci/admin/menu", luciCookie);
                    if (menu == null) {                 // 会话过期就再登一次
                        luciCookie = luciLogin(base, user, pass);
                        menu = luciCookie == null ? null : httpGet(base + "/cgi-bin/luci/admin/menu", luciCookie);
                    }
                    if (menu != null && menu.length() > 2) {
                        // 英文不用翻译表：LuCI 的 msgid 本来就是英文（源语言），
                        // 菜单 JSON 里的 title 直接可用，省一次 175KB 的请求。
                        String tr = (trLang == null || trLang.isEmpty())
                                ? null
                                : httpGet(base + "/cgi-bin/luci/admin/translations/" + trLang, luciCookie);
                        out = buildLuciPayload(menu, tr);
                    }
                } catch (Throwable ignored) {}
                postToApp("App.onLuciData(" + JSONObject.quote(out) + ");");
            }
        }).start();
    }

    private void postToApp(final String js) {
        if (web == null) return;
        web.post(new Runnable() {
            public void run() {
                try { web.evaluateJavascript(js, null); } catch (Throwable ignored) {}
            }
        });
    }

    private String luciLogin(String base, String user, String pass) {
        try {
            URL u = new URL(base + "/cgi-bin/luci/");
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(5000);
            c.setReadTimeout(9000);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            String body = "luci_username=" + URLEncoder.encode(user == null ? "" : user, "UTF-8")
                        + "&luci_password=" + URLEncoder.encode(pass == null ? "" : pass, "UTF-8");
            OutputStream os = c.getOutputStream();
            os.write(body.getBytes("UTF-8"));
            os.close();
            c.getResponseCode();
            Map<String, List<String>> hf = c.getHeaderFields();
            List<String> sc = null;
            for (Map.Entry<String, List<String>> e : hf.entrySet()) {
                if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie")) sc = e.getValue();
            }
            if (sc != null) {
                for (String one : sc) {
                    int i = one.indexOf("sysauth_http=");
                    if (i >= 0) {
                        int j = one.indexOf(';', i);
                        return j > 0 ? one.substring(i, j) : one.substring(i);
                    }
                }
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private String httpGet(String url, String cookie) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(9000);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] b = new byte[16384];
            int n;
            while ((n = in.read(b)) > 0) {
                bo.write(b, 0, n);
                if (bo.size() > 8 * 1024 * 1024) break;
            }
            in.close();
            return new String(bo.toByteArray(), "UTF-8");
        } catch (Throwable t) {
            return null;
        }
    }

    /** 把菜单树裁剪成页面用得到的形态，并顺手把标题翻成中文。
        产物：[{name,title,path,children:[{name,title,path,children:[...]}]}] */
    private String buildLuciPayload(String menuJson, String trBlob) {
        HashMap<String, String> tr = parseTr(trBlob);
        JSONArray top = new JSONArray();
        try {
            JSONObject menu = new JSONObject(menuJson);
            JSONObject admin = menu.optJSONObject("children");
            admin = admin == null ? null : admin.optJSONObject("admin");
            JSONObject kids = admin == null ? null : admin.optJSONObject("children");
            if (kids == null) return "";
            List<String> names = new ArrayList<String>();
            for (java.util.Iterator<String> it = kids.keys(); it.hasNext(); ) names.add(it.next());
            // 按 LuCI 自己的 order 字段排序，顺序和路由器上看到的一致
            Collections.sort(names, new java.util.Comparator<String>() {
                public int compare(String a, String b) {
                    return Integer.compare(ord(kidsNode(kids, a)), ord(kidsNode(kids, b)));
                }
            });
            for (String name : names) {
                JSONObject node = kidsNode(kids, name);
                if (node == null) continue;
                if (!node.optBoolean("satisfied", true)) continue;
                if (node.optString("title", "").isEmpty()) continue;
                // action.type == "function" 的是内部接口（比如 logout / ubus / uci），不是页面
                JSONObject act = node.optJSONObject("action");
                if (act != null && "function".equals(act.optString("type"))) continue;
                JSONObject item = prune(node, name, "/cgi-bin/luci/admin/" + name, tr, 2);
                if (item != null) top.put(item);
            }
        } catch (Throwable t) {
            return "";
        }
        return top.toString();
    }

    private static JSONObject kidsNode(JSONObject kids, String name) {
        return kids == null ? null : kids.optJSONObject(name);
    }

    private static int ord(JSONObject n) {
        return n == null ? 9999 : n.optInt("order", 9999);
    }

    /** 递归裁剪：丢掉没标题的、标题等于内部名（LuCI 用节点名兜底，那类都是内部动作）、
        以及 action.type=function 的节点。depth 控制下钻层数。 */
    private JSONObject prune(JSONObject node, String name, String path, HashMap<String, String> tr, int depth) {
        String title = node.optString("title", "");
        if (title.isEmpty()) return null;
        if (title.equals(name)) return null;
        JSONObject act = node.optJSONObject("action");
        if (act != null && "function".equals(act.optString("type"))) return null;

        JSONObject out = new JSONObject();
        try {
            out.put("name", name);
            // 翻译表是按 sfh(源字符串) 的哈希索引的，必须先算哈希再查
            String key = sfh(title);
            out.put("title", (key != null && tr.containsKey(key)) ? tr.get(key) : title);
            out.put("path", path);
            JSONObject kids = node.optJSONObject("children");
            if (kids != null && depth > 0) {
                List<String> names = new ArrayList<String>();
                for (java.util.Iterator<String> it = kids.keys(); it.hasNext(); ) names.add(it.next());
                Collections.sort(names, new java.util.Comparator<String>() {
                    public int compare(String a, String b) {
                        return Integer.compare(ord(kidsNode(kids, a)), ord(kidsNode(kids, b)));
                    }
                });
                JSONArray arr = new JSONArray();
                for (String cn : names) {
                    JSONObject kid = kidsNode(kids, cn);
                    if (kid == null || !kid.optBoolean("satisfied", true)) continue;
                    JSONObject sub = prune(kid, cn, path + "/" + cn, tr, depth - 1);
                    if (sub != null) arr.put(sub);
                }
                if (arr.length() > 0) out.put("children", arr);
            }
        } catch (Throwable ignored) {}
        return out;
    }

    /** 翻译表是 `window.TR={ "8位十六进制": "译文", ... };`（结尾还带个多余逗号，
        严格 JSON 解析会失败）。这里只抽出哈希->译文，不做整体解析。 */
    private HashMap<String, String> parseTr(String blob) {
        HashMap<String, String> m = new HashMap<String, String>();
        if (blob == null) return m;
        int p = blob.indexOf('{');
        if (p < 0) return m;
        java.util.regex.Matcher mt = java.util.regex.Pattern
                .compile("\"([0-9a-fA-F]{8})\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"")
                .matcher(blob.substring(p));
        while (mt.find()) {
            m.put(mt.group(1), unescapeJson(mt.group(2)));
        }
        return m;
    }

    private static String unescapeJson(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\\' || i + 1 >= s.length()) { sb.append(c); continue; }
            char n = s.charAt(++i);
            switch (n) {
                case 'n': sb.append('\n'); break;
                case 't': sb.append('\t'); break;
                case 'r': sb.append('\r'); break;
                case 'b': sb.append('\b'); break;
                case 'f': sb.append('\f'); break;
                case 'u':
                    if (i + 4 < s.length()) {
                        try { sb.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16)); }
                        catch (Throwable ignored) {}
                        i += 4;
                    }
                    break;
                default: sb.append(n);
            }
        }
        return sb.toString();
    }

    /* ---------- LuCI 的 msgid 哈希（照搬 /luci-static/resources/cbi.js 的 sfh） ---------- */

    private static int u16(byte[] b, int off) {
        return (((b[off + 1] & 0xFF) << 8) + (b[off] & 0xFF));
    }

    private static int s8(byte[] b, int off) {
        int n = b[off] & 0xFF;
        return (n > 0x7F) ? (n - 256) : n;
    }

    private static String trimws(String s) {
        return s == null ? "" : s.trim().replaceAll("[ \\t\\n]+", " ");
    }

    static String sfh(String s) {
        s = trimws(s);
        if (s.isEmpty()) return null;
        byte[] u;
        try { u = s.getBytes("UTF-8"); } catch (UnsupportedEncodingException e) { return null; }
        if (u.length == 0) return null;
        int hash = u.length;
        int len = u.length >>> 2, off = 0;
        while (len-- > 0) {
            hash += u16(u, off);
            int tmp = ((u16(u, off + 2) << 11) ^ hash);
            hash = ((hash << 16) ^ tmp);
            hash += hash >>> 11;
            off += 4;
        }
        switch (u.length & 3) {
            case 3:
                hash += u16(u, off);
                hash = hash ^ (hash << 16);
                hash = hash ^ (s8(u, off + 2) << 18);
                hash += hash >>> 11;
                break;
            case 2:
                hash += u16(u, off);
                hash = hash ^ (hash << 11);
                hash += hash >>> 17;
                break;
            case 1:
                hash += s8(u, off);
                hash = hash ^ (hash << 10);
                hash += hash >>> 1;
                break;
        }
        hash = hash ^ (hash << 3);   hash += hash >>> 5;
        hash = hash ^ (hash << 4);   hash += hash >>> 17;
        hash = hash ^ (hash << 25);  hash += hash >>> 6;
        return String.format("%08x", hash);
    }

    /* ================= 生命周期 ================= */

    /** 沉浸式全屏 + 刘海区(shortEdges)铺满；已最大化兼容新旧 API */
    private void applyImmersive() {
        Window w = getWindow();
        View decor = w.getDecorView();

        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);

        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    public void onBackPressed() {
        // 覆盖层开着时：先退路由器页面的历史，退不动了才收起覆盖层
        if (webHost != null && webHost.getVisibility() == View.VISIBLE) {
            WebView w = currentWebView();
            if (w != null && w.canGoBack()) { w.goBack(); return; }
            hideWeb();
            postToApp("window.App && App.onNativeBack && App.onNativeBack();");
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        clearWebCache();
        webSlot = null;
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    /* 启动底色：纯黑渐变。
       冷启动的窗口底色、WebView 未绘出第一帧时的底色，以及网页里 #splash 的背景，
       三处用的是同一套颜色 —— 启动画面整体是黑白的（黑底 + 白色图标）。
       颜色值改动时记得和 css/style.css 的 #splash、res/drawable/launch_bg.xml 一起改。 */
    private Drawable brandBackground() {
        return new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] { 0xFF08080A, 0xFF000000 });
    }

    /** 诊断桥：把 Android 侧真实度量暴露给页面，便于定位视口/尺寸问题 */
    class MetricsBridge {        @JavascriptInterface
        public String getMetrics() {
            try {
                DisplayMetrics dm = getResources().getDisplayMetrics();
                View decor = getWindow().getDecorView();
                WindowInsets in = decor.getRootWindowInsets();
                JSONObject o = new JSONObject();
                o.put("density", dm.density);
                o.put("densityDpi", dm.densityDpi);
                o.put("dmWidthPx", dm.widthPixels);
                o.put("dmHeightPx", dm.heightPixels);
                o.put("decorW", decor.getWidth());
                o.put("decorH", decor.getHeight());
                o.put("rootW", root == null ? -1 : root.getWidth());
                o.put("rootH", root == null ? -1 : root.getHeight());
                o.put("webW", web == null ? -1 : web.getWidth());
                o.put("webH", web == null ? -1 : web.getHeight());
                o.put("contentHeight", web == null ? -1 : web.getContentHeight());
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("cachedPages", webCache.size());
                if (in != null) {
                    o.put("insetTop", in.getInsets(WindowInsets.Type.systemBars()).top);
                    o.put("insetBottom", in.getInsets(WindowInsets.Type.systemBars()).bottom);
                    o.put("cutoutTop", in.getInsets(WindowInsets.Type.displayCutout()).top);
                }
                return o.toString();
            } catch (Exception e) {
                return "{\"error\":\"" + e.getMessage() + "\"}";
            }
        }
    }

    /**
     * 原生能力桥。页面侧只需要 window.OwrNative。
     *
     * 注意：@JavascriptInterface 方法跑在 WebView 的 JavaBridge 线程上，不是 UI 线程，
     * 所以所有对 View 的操作都必须 post 到 UI 线程。
     */
    class OwrNative {
        @JavascriptInterface
        public boolean available() { return true; }

        /** 在 App 内部打开一个路由器页面，不离开 App 界面 */
        @JavascriptInterface
        public void openWeb(final String id, final String url, final String title,
                            final String user, final String pass,
                            final int topPx, final int bottomPx) {
            runOnUiThread(new Runnable() {
                public void run() { showWeb(id, url, title, user, pass, topPx, bottomPx); }
            });
        }

        /** 收起覆盖层，回到 App 自己的内容 */
        @JavascriptInterface
        public void closeWeb() {
            runOnUiThread(new Runnable() { public void run() { hideWeb(); } });
        }

        /** 标题栏 / 底栏几何变化（旋转、状态条显隐）时重新对齐留白 */
        @JavascriptInterface
        public void setWebInsets(final int topPx, final int bottomPx) {
            runOnUiThread(new Runnable() {
                public void run() { applyWebInsets(topPx, bottomPx); }
            });
        }

        @JavascriptInterface
        public void webReload() {
            runOnUiThread(new Runnable() {
                public void run() {
                    WebView w = currentWebView();
                    if (w != null) w.reload();
                }
            });
        }

        /** 登录成功后凭据可能变了，把缓存的页面连同旧密码一起丢掉 */
        @JavascriptInterface
        public void clearWebCacheJs() {
            runOnUiThread(new Runnable() { public void run() { clearWebCache(); } });
        }

        /** 手机当前 Wi-Fi 的「网关 / 本机地址 / 网段」。
            「自动获取地址」用它把候选范围从「常见默认网关」缩小到「本机所在网段的网关」——
            这是命中率最高、又几乎不花时间的那一个。取不到就返回空串，页面侧会退回扫默认列表。 */
        @JavascriptInterface
        public String getWifiInfo() {
            JSONObject o = new JSONObject();
            try {
                o.put("gateway", "");
                o.put("ip", "");
                o.put("prefix", 0);
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm == null) return o.toString();
                Network n = cm.getActiveNetwork();
                if (n == null) return o.toString();
                LinkProperties lp = cm.getLinkProperties(n);
                if (lp == null) return o.toString();
                // 默认路由的下一跳就是路由器
                for (RouteInfo r : lp.getRoutes()) {
                    if (r.isDefaultRoute() && r.getGateway() != null) {
                        o.put("gateway", r.getGateway().getHostAddress());
                        break;
                    }
                }
                for (android.net.LinkAddress la : lp.getLinkAddresses()) {
                    InetAddress a = la.getAddress();
                    if (a instanceof java.net.Inet4Address) {
                        o.put("ip", a.getHostAddress());
                        o.put("prefix", la.getPrefixLength());
                        break;
                    }
                }
            } catch (Throwable ignored) {}
            return o.toString();
        }

        /** 拉取 LuCI 菜单树 + 指定语言的翻译表（后台线程，完成后回调 App.onLuciData）。
            trLang 为空串表示不翻译（英文 = 用源字符串）。 */
        @JavascriptInterface
        public void luciData(final String base, final String user, final String pass,
                             final String trLang) {
            fetchLuciData(base, user, pass, trLang);
        }
    }
}

/** 原生 Tailscale 状态桥：枚举本机网络接口，识别 100.64.0.0/10 网段地址 */
class TailscaleBridge {
    @JavascriptInterface
    public String getState() {
        try {
            ArrayList<String> ips = new ArrayList<>();
            boolean connected = false;
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                    byte[] b = addr.getAddress();
                    if (b.length == 4 && (b[0] & 0xFF) == 100 && (b[1] & 0xC0) == 0x40) {
                        ips.add(addr.getHostAddress());
                        connected = true;
                    }
                }
            }
            JSONObject o = new JSONObject();
            o.put("connected", connected);
            o.put("ips", new JSONArray(ips));
            return o.toString();
        } catch (Exception e) {
            return "{\"connected\":false,\"ips\":[]}";
        }
    }
}

package se.sjomatning.mobile;

import android.content.*;
import android.net.Uri;
import android.location.Location;
import android.view.MotionEvent;
import android.webkit.*;
import org.json.*;
import java.io.ByteArrayInputStream;
import java.util.concurrent.*;

/** Bundled map UI with a login-prompt bridge and read-only library proxy; credentials stay native. */
public final class ChartView extends WebView {
    static final String HOME="https://appassets.androidplatform.net/chart.html";
    private String payload="{\"fix\":null}",lastPayload="";
    private final ChartLibrary library=new ChartLibrary();
    private final ExecutorService network=Executors.newSingleThreadExecutor();
    private boolean closed=false,asking=false;
    private final AccessSession access;
    public ChartView(android.app.Activity context){this(context,new AccessSession(context));}
    ChartView(android.app.Activity context,AccessSession access){
        super(context);this.access=access;setContentDescription("Sjökarta med telefonens position");
        getSettings().setJavaScriptEnabled(true);getSettings().setAllowFileAccess(false);getSettings().setAllowContentAccess(false);
        getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        getSettings().setUserAgentString(getSettings().getUserAgentString()+" SjomatningGPS/0.1.7 (+"+CloudSync.ORIGIN+")");
        addJavascriptInterface(new Object(){@JavascriptInterface public void openLibrary(){post(()->login(context));}},"ChartAccess");
        setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();String path=uri.getPath();
                if("https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost())&&path!=null&&path.startsWith("/api/")&&"GET".equals(request.getMethod())){
                    try{return new WebResourceResponse(path.endsWith("/content")?"application/octet-stream":"application/json","UTF-8",library.read(path.substring(5)));}catch(Exception e){if(e instanceof AccessSession.InvalidKeyException)post(()->{if(!closed){login(context);}});return new WebResourceResponse("application/json","UTF-8",401,"Unauthorized",java.util.Collections.emptyMap(),new ByteArrayInputStream("{}".getBytes()));}
                }
                if("https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost())&&path!=null&&path.matches("/(chart.html|chart.mjs|web-map.mjs|manuscripts.mjs|geo-reference.mjs|raster-chart.mjs|pdf.mjs|pdf.worker.mjs)")){
                    try{return new WebResourceResponse(path.endsWith("html")?"text/html":"text/javascript","UTF-8",context.getAssets().open(path.substring(1)));}catch(Exception ignored){}
                }
                if("https".equals(uri.getScheme())&&("tile.openstreetmap.org".equals(uri.getHost())||"tiles.openseamap.org".equals(uri.getHost())))return null;
                return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();if(request.isForMainFrame()&&"https".equals(uri.getScheme())&&("www.openstreetmap.org".equals(uri.getHost())||"www.openseamap.org".equals(uri.getHost())))context.startActivity(new Intent(Intent.ACTION_VIEW,uri));return true;
            }
            @Override public void onPageFinished(WebView view,String url){lastPayload="";send();}
        });
        loadUrl(HOME);
    }
    private void login(Context context){
        if(closed||asking)return;asking=true;
        access.require(token->network.execute(()->{try{library.login(token);post(()->{asking=false;if(!closed)evaluateJavascript("window.libraryReady()",null);});}catch(Exception e){post(()->{asking=false;if(e instanceof AccessSession.InvalidKeyException){login(context);}else libraryError(e.getMessage());});}}),()->{asking=false;libraryError("Inloggning avbruten");});
    }
    private void libraryError(String message){if(!closed)evaluateJavascript("window.libraryError("+JSONObject.quote(message)+")",null);}
    public void position(Location fix,boolean fresh){
        try{JSONObject data=new JSONObject();
            if(fix!=null&&Double.isFinite(fix.getLatitude())&&Double.isFinite(fix.getLongitude()))data.put("fix",new JSONObject().put("lat",fix.getLatitude()).put("lon",fix.getLongitude()).put("accuracy",fix.getAccuracy()).put("fresh",fresh));else data.put("fix",JSONObject.NULL);
            payload=data.toString();send();
        }catch(JSONException ignored){}
    }
    private void send(){if(payload.equals(lastPayload))return;lastPayload=payload;evaluateJavascript("window.updatePosition && window.updatePosition("+payload+")",null);}
    @Override public void destroy(){closed=true;library.clear();network.shutdownNow();removeJavascriptInterface("ChartAccess");super.destroy();}
    @Override public boolean onTouchEvent(MotionEvent event){if(event.getActionMasked()==MotionEvent.ACTION_DOWN)getParent().requestDisallowInterceptTouchEvent(true);if(event.getActionMasked()==MotionEvent.ACTION_UP||event.getActionMasked()==MotionEvent.ACTION_CANCEL)getParent().requestDisallowInterceptTouchEvent(false);return super.onTouchEvent(event);}
}

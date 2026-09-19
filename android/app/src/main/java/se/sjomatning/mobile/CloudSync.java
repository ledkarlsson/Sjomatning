package se.sjomatning.mobile;

import org.json.*;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.List;

public class CloudSync {
    public static final String ORIGIN="https://sjomatning-web.led-karlsson.workers.dev";
    private String cookie="";
    public interface Progress { void update(String message); }
    protected String request(String path,String method,byte[] body) throws Exception {
        HttpsURLConnection connection=(HttpsURLConnection)new URL(ORIGIN+"/api/"+path).openConnection();
        try {
            connection.setRequestMethod(method);connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(20000);connection.setReadTimeout(60000);
            connection.setRequestProperty("Origin",ORIGIN);connection.setRequestProperty("Cookie",cookie);
            if(body!=null){connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);connection.setRequestProperty("Content-Type",path.equals("login")?"application/json":"application/octet-stream");try(OutputStream output=connection.getOutputStream()){output.write(body);}}
            int status=connection.getResponseCode();if(status==401)throw new AccessSession.InvalidKeyException();InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            if(input!=null)try(InputStream stream=input){byte[] buffer=new byte[8192];int length;while((length=stream.read(buffer))!=-1){if(bytes.size()+length>16*1024*1024)throw new IOException("Bibliotekssvaret är för stort.");bytes.write(buffer,0,length);}}
            String text=bytes.toString(StandardCharsets.UTF_8.name());
            if(status<200||status>=300){String error="Serverfel ("+status+"). Försök igen.";try{error=new JSONObject(text).optString("error",error);}catch(JSONException ignored){}throw new IOException(error);}
            if(path.equals("login")){String header=connection.getHeaderField("Set-Cookie");if(header==null)throw new IOException("Inloggningen saknar session.");cookie=header.split(";",2)[0];}
            return text;
        } finally {connection.disconnect();}
    }
    public String sync(SurveyStore store,String token,Progress progress) throws Exception {
        if(token.trim().isEmpty())throw new IllegalArgumentException("Ange din personliga åtkomstnyckel.");
        try {
            progress.update("Loggar in…");request("login","POST",new JSONObject().put("password",token.trim()).toString().getBytes(StandardCharsets.UTF_8));
            JSONObject user=new JSONObject(request("session","GET",null));if(!user.optBoolean("storageReady"))throw new IOException("Webblagringen är inte tillgänglig.");
            String owner=user.getString("id");JSONArray remote=new JSONArray(request("files","GET",null));
            List<SurveyStore.Segment> segments=store.list();int uploaded=0,existing=0,failed=0;String lastError="";
            for(SurveyStore.Segment segment:segments){
                if(!segment.closed)continue;
                if(segment.count==0){store.receipt(segment.id,owner,null);continue;}
                progress.update("Synkar "+segment.name+" · "+segment.count+" punkter…");
                try{
                    byte[] csv=store.csv(segment);if(csv.length>95*1024*1024)throw new IOException("Mätningen är större än 95 MB.");
                    String hash=SurveyFormat.sha256(csv),id=null;
                    for(int i=0;i<remote.length();i++){JSONObject file=remote.getJSONObject(i);if(owner.equals(file.optString("owner"))&&hash.equals(file.optString("syncId"))){id=file.getString("id");break;}}
                    if(id==null){JSONObject file=new JSONObject(request("files?name="+URLEncoder.encode(segment.fileName(),StandardCharsets.UTF_8.name())+"&syncId="+hash,"POST",csv));id=file.getString("id");uploaded++;}
                    else existing++;
                    store.receipt(segment.id,owner,id);
                }catch(Exception e){if(e instanceof AccessSession.InvalidKeyException)throw e;failed++;lastError=e.getMessage();}
            }
            // Upload replacements before deleting previous revisions. Keep the queue on errors.
            JSONArray current=new JSONArray(request("files","GET",null));
            for(String obsolete:store.pendingDeletes(owner))try{
                boolean exists=false;
                for(int i=0;i<current.length();i++){JSONObject file=current.getJSONObject(i);if(obsolete.equals(file.getString("id"))&&owner.equals(file.optString("owner"))){exists=true;break;}}
                if(exists)request("files/"+obsolete,"DELETE",null);
                store.deletedRemote(owner,obsolete);
            }catch(Exception e){if(e instanceof AccessSession.InvalidKeyException)throw e;failed++;lastError=e.getMessage();}
            return uploaded+" uppladdade, "+existing+" redan synkade"+(failed>0?", "+failed+" misslyckades: "+lastError:". Klart!")+"\nOriginalen finns kvar i telefonen.";
        }finally{cookie="";}
    }
}

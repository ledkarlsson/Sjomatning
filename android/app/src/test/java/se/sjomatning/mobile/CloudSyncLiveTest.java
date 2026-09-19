package se.sjomatning.mobile;

import android.content.Context;
import android.location.Location;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class CloudSyncLiveTest {
    private String cookie="";
    private String request(String path,String method,String body)throws Exception{
        HttpsURLConnection c=(HttpsURLConnection)new URL(CloudSync.ORIGIN+"/api/"+path).openConnection();
        try{c.setRequestMethod(method);c.setConnectTimeout(20000);c.setReadTimeout(60000);c.setRequestProperty("Origin",CloudSync.ORIGIN);c.setRequestProperty("Cookie",cookie);
            if(body!=null){byte[] b=body.getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(b.length);try(OutputStream out=c.getOutputStream()){out.write(b);}}
            assertTrue("HTTP "+c.getResponseCode(),c.getResponseCode()>=200&&c.getResponseCode()<300);
            if(path.equals("login"))cookie=c.getHeaderField("Set-Cookie").split(";",2)[0];
            try(InputStream in=c.getInputStream()){return new String(in.readAllBytes(),StandardCharsets.UTF_8);}
        }finally{c.disconnect();}
    }
    @Test public void phoneSyncUploadsOnceAndPreservesCsv()throws Exception{
        Assume.assumeTrue("Explicit opt-in required for production smoke test","1".equals(System.getenv("SJOMATNING_LIVE_TEST")));
        String token=new String(Files.readAllBytes(new File("../../web/admin-access.txt").toPath()),StandardCharsets.UTF_8).trim();
        request("login","POST",new JSONObject().put("password",token).toString());
        Context context=RuntimeEnvironment.getApplication();context.deleteDatabase("survey.db");
        String hash="";java.util.Set<String> hashes=new java.util.HashSet<>();
        try(SurveyStore store=new SurveyStore(context)){
            String id=store.start("ANDROID-DRIFTPROV-"+UUID.randomUUID(),4.2);
            Location fix=new Location("gps");fix.setTime(System.currentTimeMillis());fix.setLatitude(58.52);fix.setLongitude(15.70);fix.setAccuracy(5);store.add(id,fix);store.closeSegments();
            byte[] csv=store.csv(store.list().get(0));hash=SurveyFormat.sha256(csv);hashes.add(hash);
            String first=new CloudSync().sync(store,token,message->{});assertTrue(first,first.startsWith("1 uppladdade"));
            String second=new CloudSync().sync(store,token,message->{});assertTrue(second,second.startsWith("0 uppladdade, 1 redan synkade"));
            JSONArray files=new JSONArray(request("files","GET",null));int count=0;
            for(int i=0;i<files.length();i++){JSONObject file=files.getJSONObject(i);if(hash.equals(file.optString("syncId"))&&"admin".equals(file.optString("owner"))){count++;assertEquals(new String(csv,StandardCharsets.UTF_8),request("files/"+file.getString("id")+"/content","GET",null));}}
            assertEquals(1,count);
            long pointId=store.points(1).get(0).id;store.editPoint(pointId,6.3,58.521,15.701);
            byte[] edited=store.csv(store.list().get(0));String changedHash=SurveyFormat.sha256(edited);hashes.add(changedHash);
            String changed=new CloudSync().sync(store,token,message->{});assertFalse(changed,changed.contains("misslyckades"));
            files=new JSONArray(request("files","GET",null));count=0;
            for(int i=0;i<files.length();i++){JSONObject file=files.getJSONObject(i);if(!"admin".equals(file.optString("owner")))continue;assertFalse(hash.equals(file.optString("syncId")));if(changedHash.equals(file.optString("syncId"))){count++;assertEquals(new String(edited,StandardCharsets.UTF_8),request("files/"+file.getString("id")+"/content","GET",null));}}
            assertEquals(1,count);store.deletePoint(pointId);String deleted=new CloudSync().sync(store,token,message->{});assertFalse(deleted,deleted.contains("misslyckades"));
            files=new JSONArray(request("files","GET",null));for(int i=0;i<files.length();i++){JSONObject file=files.getJSONObject(i);if("admin".equals(file.optString("owner")))assertFalse(hashes.contains(file.optString("syncId")));}
        }finally{
            JSONArray files=new JSONArray(request("files","GET",null));
            for(int i=0;i<files.length();i++){JSONObject file=files.getJSONObject(i);if(hashes.contains(file.optString("syncId"))&&"admin".equals(file.optString("owner")))request("files/"+file.getString("id"),"DELETE",null);}
        }
    }
}

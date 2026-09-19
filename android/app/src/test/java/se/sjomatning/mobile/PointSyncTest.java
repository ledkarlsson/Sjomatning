package se.sjomatning.mobile;

import android.content.Context;
import android.location.Location;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class PointSyncTest {
    private SurveyStore store;private FakeCloud cloud;
    @Before public void setup(){Context context=RuntimeEnvironment.getApplication();context.deleteDatabase("survey.db");store=new SurveyStore(context);cloud=new FakeCloud();}
    @After public void close(){store.close();}
    private long add(){String id=store.start("Punkt",3);Location fix=new Location("gps");fix.setTime(1234567890000L);fix.setLatitude(58);fix.setLongitude(15);fix.setAccuracy(5);store.add(id,fix);store.closeSegments();return store.points(1).get(0).id;}
    @Test public void editReplacesRemoteAndDeleteRemovesIt()throws Exception{
        long id=add();cloud.sync(store,"key",m->{});String old=cloud.files.keySet().iterator().next();
        store.editPoint(id,7.5,59,16);assertEquals(1234567890000L,store.points(1).get(0).time);
        cloud.sync(store,"key",m->{});assertEquals(1,cloud.files.size());assertFalse(cloud.files.containsKey(old));assertTrue(cloud.bodies.values().iterator().next().contains("59.0000000,16.0000000,,7.500"));
        store.deletePoint(id);cloud.sync(store,"key",m->{});assertTrue(cloud.files.isEmpty());assertTrue(store.points(10).isEmpty());
    }
    @Test public void failedUploadKeepsOldRemoteAndFailedDeleteRetries()throws Exception{
        long id=add();cloud.sync(store,"key",m->{});String old=cloud.files.keySet().iterator().next();store.editPoint(id,8,58,15);
        cloud.failUpload=true;assertTrue(cloud.sync(store,"key",m->{}).contains("misslyckades"));assertTrue(cloud.files.containsKey(old));
        cloud.failUpload=false;cloud.failDelete=true;cloud.sync(store,"key",m->{});assertEquals(2,cloud.files.size());assertEquals(1,store.pendingDeletes("owner").size());
        cloud.failDelete=false;cloud.sync(store,"key",m->{});assertEquals(1,cloud.files.size());assertTrue(store.pendingDeletes("owner").isEmpty());
    }
    @Test public void editOneLegacyPointPreservesOtherDepthAndRejectsInvalidCoordinates(){
        long id=add();SurveyStore.Segment segment=store.list().get(0);Location fix=new Location("gps");fix.setTime(1234567891000L);fix.setLatitude(58);fix.setLongitude(15);store.add(segment.id,fix);
        store.editPoint(id,9,58,15);assertEquals(3,store.points(10).get(0).depth,0);assertEquals(9,store.points(10).get(1).depth,0);
        try{store.editPoint(id,4,91,15);fail();}catch(IllegalArgumentException expected){}assertEquals(9,store.points(10).get(1).depth,0);
    }
    @Test public void deleteQueueIsScopedToAccount()throws Exception{
        long id=add();cloud.sync(store,"key",m->{});store.receipt(store.list().get(0).id,"other","other-file");store.deletePoint(id);cloud.sync(store,"key",m->{});
        assertTrue(store.pendingDeletes("other").isEmpty());store.receipt(store.list().get(0).id,"other",null);assertEquals(Collections.singletonList("other-file"),store.pendingDeletes("other"));
    }
    private static final class FakeCloud extends CloudSync {
        final Map<String,JSONObject> files=new LinkedHashMap<>();final Map<String,String> bodies=new LinkedHashMap<>();boolean failUpload,failDelete;
        @Override protected String request(String path,String method,byte[] body)throws Exception{
            if(path.equals("login"))return "{}";
            if(path.equals("session"))return "{\"id\":\"owner\",\"storageReady\":true}";
            if(path.equals("files"))return new JSONArray(files.values()).toString();
            if(method.equals("POST")){if(failUpload)throw new IOException("Offline");String hash=path.substring(path.indexOf("syncId=")+7);for(JSONObject file:files.values())if(hash.equals(file.getString("syncId")))return file.toString();String id=UUID.randomUUID().toString();JSONObject file=new JSONObject().put("id",id).put("owner","owner").put("syncId",hash);files.put(id,file);bodies.put(id,new String(body,StandardCharsets.UTF_8));return file.toString();}
            if(method.equals("DELETE")){if(failDelete)throw new IOException("Offline");String id=path.substring(6);files.remove(id);bodies.remove(id);return "{}";}
            throw new AssertionError(path);
        }
    }
}

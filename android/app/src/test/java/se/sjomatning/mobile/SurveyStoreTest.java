package se.sjomatning.mobile;

import android.content.Context;
import android.location.Location;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class SurveyStoreTest {
    private Context context;
    @Before public void setup(){context=RuntimeEnvironment.getApplication();context.deleteDatabase("survey.db");}
    private Location fix(){Location fix=new Location("gps");fix.setTime(Instant.parse("2026-09-19T12:30:00Z").toEpochMilli());fix.setLatitude(58.52);fix.setLongitude(15.7);fix.setAccuracy(7);return fix;}
    @Test public void completedSegmentSurvivesReopenAndPreservesManualDepth(){
        try(SurveyStore store=new SurveyStore(context)){String id=store.start("Roxen",4.2);store.add(id,fix());store.closeSegments();}
        try(SurveyStore store=new SurveyStore(context)){SurveyStore.Segment segment=store.list().get(0);assertEquals(1,segment.count);assertTrue(segment.closed);String csv=new String(store.csv(segment),StandardCharsets.UTF_8);assertTrue(csv.contains("2026-09-19,12:30:00.000Z,58.5200000,15.7000000,,4.200"));}
    }
    @Test public void newDepthStartsSeparateSegmentAndDoesNotRewriteOldPoints(){
        try(SurveyStore store=new SurveyStore(context)){String first=store.start("Roxen",3);store.add(first,fix());String second=store.start("Roxen",5);store.add(second,fix());store.closeSegments();assertEquals(2,store.list().size());for(SurveyStore.Segment segment:store.list()){assertTrue(segment.closed);assertEquals(1,segment.count);assertEquals(segment.id.equals(first)?3:5,segment.depth,0);}}
    }
    @Test public void unfinishedSegmentCanBeRecoveredWithoutLosingPoint(){
        try(SurveyStore store=new SurveyStore(context)){String id=store.start("Avbrutet",2);store.add(id,fix());try{store.csv(store.list().get(0));fail();}catch(IllegalStateException expected){}}
        try(SurveyStore store=new SurveyStore(context)){store.closeSegments();SurveyStore.Segment segment=store.list().get(0);assertTrue(segment.closed);assertEquals(1,segment.count);store.receipt(segment.id,"user-a","remote");assertTrue(store.list().get(0).synced);assertEquals(1,store.list().get(0).count);}
    }
    @Test public void pointListShowsNewestFirstWithItsOwnDepthAndTimeAfterReopen(){
        try(SurveyStore store=new SurveyStore(context)){
            String first=store.start("Första",3);store.add(first,fix());
            String second=store.start("Andra",5);Location next=fix();next.setTime(next.getTime()+1000);next.setLatitude(58.53);store.add(second,next);store.closeSegments();
        }
        try(SurveyStore store=new SurveyStore(context)){
            assertEquals(2,store.points(50).size());assertEquals(1,store.points(1).size());
            SurveyStore.Point newest=store.points(1).get(0);
            assertEquals("Andra",newest.name);assertEquals(5,newest.depth,0);assertEquals(58.53,newest.lat,0);assertEquals(fix().getTime()+1000,newest.time);
            assertEquals(3,store.points(50).get(1).depth,0);
        }
    }
}

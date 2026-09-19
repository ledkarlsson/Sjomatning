package se.sjomatning.mobile;

import android.Manifest;
import android.app.Application;
import android.content.Intent;
import android.location.Location;
import android.os.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import java.time.Duration;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class SurveyServiceTest {
    private Application app;private ServiceController<SurveyService> controller;private SurveyService service;
    @Before public void setup(){app=RuntimeEnvironment.getApplication();app.deleteDatabase("survey.db");SurveyService.running=false;SurveyService.active=null;SurveyService.latest=null;controller=Robolectric.buildService(SurveyService.class).create();service=controller.get();}
    @After public void cleanup(){controller.destroy();}
    private Location fix(float accuracy){Location fix=new Location("gps");fix.setLatitude(58.52);fix.setLongitude(15.7);fix.setAccuracy(accuracy);fix.setTime(System.currentTimeMillis());fix.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());return fix;}
    private void start(){shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION);service.onStartCommand(new Intent().setAction(SurveyService.GPS),0,1);SurveyService.latest=fix(5);}
    @Test public void requiresPermissionBeforeStartingGps(){service.onStartCommand(new Intent().setAction(SurveyService.GPS),0,1);assertFalse(SurveyService.running);assertTrue(SurveyService.status.contains("exakt plats"));}
    @Test public void capturesManualDepthAndClosesOnPause(){
        start();service.onStartCommand(new Intent().setAction(SurveyService.START).putExtra("name","Roxen").putExtra("depth",4.2),0,2);
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2));service.onLocationChanged(fix(6));
        service.onStartCommand(new Intent().setAction(SurveyService.PAUSE),0,3);
        try(SurveyStore store=new SurveyStore(app)){assertEquals(2,store.list().get(0).count);assertEquals(4.2,store.list().get(0).depth,0);assertTrue(store.list().get(0).closed);}
        assertNull(SurveyService.active);
    }
    @Test public void gpsLossClosesSegmentWithoutInventingPoints(){
        start();service.onStartCommand(new Intent().setAction(SurveyService.START).putExtra("depth",3.0),0,2);
        service.onLocationChanged(fix(100));shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(5));
        assertNull(SurveyService.active);
        try(SurveyStore store=new SurveyStore(app)){assertEquals(1,store.list().get(0).count);assertTrue(store.list().get(0).closed);}
    }
}

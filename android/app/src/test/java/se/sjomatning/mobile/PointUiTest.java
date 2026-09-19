package se.sjomatning.mobile;

import android.Manifest;
import android.app.Application;
import android.content.Intent;
import android.database.sqlite.SQLiteDatabase;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class PointUiTest {
    @Before public void setup(){Application app=RuntimeEnvironment.getApplication();app.deleteDatabase("survey.db");SurveyService.running=false;SurveyService.active=null;SurveyService.latest=null;}
    @Test public void openingAppStartsGpsAndReturningRestartsStoppedGps(){
        Application app=RuntimeEnvironment.getApplication();shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        try(ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class).create().start().resume()){
            Intent first=shadowOf(app).getNextStartedService();assertNotNull(first);assertEquals(SurveyService.GPS,first.getAction());
            controller.pause().resume();assertEquals(SurveyService.GPS,shadowOf(app).getNextStartedService().getAction());
        }
    }
    @Test public void upgradesExistingPointsAndReceiptsWithoutLoss(){
        Application app=RuntimeEnvironment.getApplication();
        try(SQLiteDatabase db=app.openOrCreateDatabase("survey.db",0,null)){
            db.execSQL("CREATE TABLE segments(id TEXT PRIMARY KEY,name TEXT,depth REAL,created INTEGER,closed INTEGER)");
            db.execSQL("CREATE TABLE points(id INTEGER PRIMARY KEY,segment TEXT,time INTEGER,lat REAL,lon REAL,speed REAL,accuracy REAL)");
            db.execSQL("CREATE TABLE receipts(segment TEXT,user TEXT,remote TEXT,PRIMARY KEY(segment,user))");
            db.execSQL("INSERT INTO segments VALUES('s','Äldre',4.2,1000,1)");db.execSQL("INSERT INTO points VALUES(1,'s',2000,58,15,NULL,5)");db.execSQL("INSERT INTO receipts VALUES('s','owner','remote')");db.setVersion(1);
        }
        try(SurveyStore store=new SurveyStore(app)){assertEquals(4.2,store.points(10).get(0).depth,0);assertEquals(2000,store.points(10).get(0).time);store.receipt("s","owner",null);assertEquals("remote",store.pendingDeletes("owner").get(0));}
    }
}

package se.sjomatning.mobile;

import android.app.*;
import android.os.Looper;
import android.view.*;
import android.widget.EditText;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;
import java.io.IOException;
import java.util.*;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class AccessSessionTest {
    private ActivityController<Activity> controller;private AccessSession session;private final List<String> actions=new ArrayList<>();
    @Before public void setup(){AccessSession.invalidate();controller=Robolectric.buildActivity(Activity.class).setup();session=new AccessSession(controller.get(),key->{if(!key.equals("valid"))throw new AccessSession.InvalidKeyException();},Runnable::run);}
    @After public void close(){session.close();controller.close();AccessSession.invalidate();}
    private EditText input(View view){if(view instanceof EditText)return (EditText)view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){EditText result=input(((ViewGroup)view).getChildAt(i));if(result!=null)return result;}return null;}
    @Test public void onePromptServesSyncAndChartsAndSurvivesActivityRecreation(){
        session.require(key->actions.add("sync:"+key),()->fail());Shadows.shadowOf(Looper.getMainLooper()).idle();AlertDialog first=ShadowAlertDialog.getLatestAlertDialog();assertTrue(first.isShowing());
        input(first.getWindow().getDecorView()).setText("valid");first.getButton(AlertDialog.BUTTON_POSITIVE).performClick();Shadows.shadowOf(Looper.getMainLooper()).idle();assertFalse(first.isShowing());
        AccessSession next=new AccessSession(controller.get(),key->{assertEquals("valid",key);},Runnable::run);next.require(key->actions.add("chart:"+key),()->fail());Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(Arrays.asList("sync:valid","chart:valid"),actions);assertSame(first,ShadowAlertDialog.getLatestAlertDialog());
    }
    @Test public void invalidKeyCanBeCorrectedAndCancelDoesNotRunAction(){
        session.require(actions::add,()->actions.add("cancel"));Shadows.shadowOf(Looper.getMainLooper()).idle();AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog();EditText input=input(dialog.getWindow().getDecorView());input.setText("wrong");dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();Shadows.shadowOf(Looper.getMainLooper()).idle();assertTrue(dialog.isShowing());assertNotNull(input.getError());assertTrue(actions.isEmpty());
        input.setText("valid");dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();Shadows.shadowOf(Looper.getMainLooper()).idle();assertEquals(Collections.singletonList("valid"),actions);
        AccessSession.invalidate();session.require(actions::add,()->actions.add("cancel"));Shadows.shadowOf(Looper.getMainLooper()).idle();ShadowAlertDialog.getLatestAlertDialog().getButton(AlertDialog.BUTTON_NEGATIVE).performClick();Shadows.shadowOf(Looper.getMainLooper()).idle();assertEquals(Arrays.asList("valid","cancel"),actions);
    }

    @Test public void savedKeySurvivesNewInstanceAndInvalidKeyPromptsImmediately(){
        controller.get().getSharedPreferences("web_access",0).edit().putString("key","expired").commit();
        session.close();AccessSession restarted=new AccessSession(controller.get(),key->{throw new AccessSession.InvalidKeyException();},Runnable::run);
        restarted.require(actions::add,()->{});Shadows.shadowOf(Looper.getMainLooper()).idle();
        AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog();assertTrue(dialog.isShowing());assertNotNull(input(dialog.getWindow().getDecorView()));assertFalse(controller.get().getSharedPreferences("web_access",0).contains("key"));assertTrue(actions.isEmpty());restarted.close();
    }
    @Test public void offlineDoesNotEraseSavedKeyOrAskForReplacement(){
        controller.get().getSharedPreferences("web_access",0).edit().putString("key","valid").commit();
        AccessSession offline=new AccessSession(controller.get(),key->{throw new IOException("Offline");},Runnable::run);offline.require(actions::add,()->{});Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals("valid",controller.get().getSharedPreferences("web_access",0).getString("key",null));assertTrue(actions.isEmpty());assertNull(input(ShadowAlertDialog.getLatestAlertDialog().getWindow().getDecorView()));ShadowAlertDialog.getLatestAlertDialog().dismiss();
    }
}

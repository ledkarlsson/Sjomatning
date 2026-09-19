package se.sjomatning.mobile;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;

public final class SurveyService extends Service implements LocationListener {
    public static final String GPS="gps", START="segment", POINT="point", PAUSE="pause", STOP="stop";
    public static volatile boolean running=false;
    public static volatile Location latest=null;
    public static volatile String status="GPS är avstängd", active=null;
    private LocationManager manager;private SurveyStore store;private long lastStoredNanos=0;
    private final Handler watchdog=new Handler(Looper.getMainLooper());
    private final Runnable checkFix=new Runnable(){@Override public void run(){
        if(active!=null&&!fresh(latest)){store.closeSegments();active=null;status="GPS tappades. Avsnittet är sparat; starta ett nytt när GPS är tillbaka.";getSystemService(NotificationManager.class).notify(1,notification());}
        watchdog.postDelayed(this,5000);
    }};
    @Override public void onCreate(){super.onCreate();store=new SurveyStore(this);store.closeSegments();manager=(LocationManager)getSystemService(LOCATION_SERVICE);watchdog.postDelayed(checkFix,5000);}
    private Notification notification(){
        NotificationManager nm=getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("survey","GPS-mätning",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,SurveyService.class).setAction(STOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,"survey").setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("Sjömätning GPS").setContentText(active==null?"GPS aktiv · lägg till punkter i appen":"Spelar in avsnitt med manuellt djup").setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null,"Stoppa GPS",stop).build()).build();
    }
    public static boolean fresh(Location fix){return fix!=null&&fix.hasAccuracy()&&SurveyFormat.validFix(fix.getLatitude(),fix.getLongitude(),fix.getAccuracy(),(SystemClock.elapsedRealtimeNanos()-fix.getElapsedRealtimeNanos())/1000000);}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null)return START_NOT_STICKY;
        if(STOP.equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        try{
            if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)throw new IllegalStateException("Tillåt exakt plats för GPS-mätning.");
            startForeground(1,notification());
            if(!running){manager.requestLocationUpdates(LocationManager.GPS_PROVIDER,2000,0,this);running=true;status=manager.isProviderEnabled(LocationManager.GPS_PROVIDER)?"Väntar på GPS utomhus…":"Slå på telefonens platstjänster för att få GPS-position.";}
            String action=intent.getAction();
            if(PAUSE.equals(action)){store.closeSegments();active=null;status="Avsnittet sparat i telefonen.";}
            if(START.equals(action)||POINT.equals(action)){
                Location fix=latest;
                if(!fresh(fix))throw new IllegalStateException("Vänta på en färsk GPS-position med noggrannhet högst 30 m.");
                double depth=intent.getDoubleExtra("depth",Double.NaN);SurveyFormat.depth(Double.toString(depth));
                active=store.start(intent.getStringExtra("name")==null?"Spår":intent.getStringExtra("name"),depth);store.add(active,fix);lastStoredNanos=fix.getElapsedRealtimeNanos();
                if(POINT.equals(action)){store.closeSegments();active=null;status="Djupunkten sparad i telefonen.";}else status="Spelar in avsnitt. Datum och tid sätts automatiskt.";
            }
            getSystemService(NotificationManager.class).notify(1,notification());
        }catch(Exception e){status=e.getMessage();if(!running||e instanceof android.database.sqlite.SQLiteException)stopSelf();}
        return START_NOT_STICKY;
    }
    @Override public void onLocationChanged(Location fix){
        latest=new Location(fix);
        if(!fresh(fix)){status="GPS-positionen är för gammal eller osäker. Inga punkter sparas.";return;}
        if(active!=null&&fix.getElapsedRealtimeNanos()-lastStoredNanos>15000000000L){store.closeSegments();active=null;status="GPS-avbrott. Starta ett nytt avsnitt för att fortsätta.";getSystemService(NotificationManager.class).notify(1,notification());return;}
        if(active!=null)try{if(fix.getElapsedRealtimeNanos()>lastStoredNanos){store.add(active,fix);lastStoredNanos=fix.getElapsedRealtimeNanos();}status="Spelar in avsnitt med manuellt djup.";}catch(Exception e){status="Kunde inte spara i telefonen. Inspelningen har stoppats.";active=null;stopSelf();}
        else status="GPS klar. Ange djup och lägg till en punkt.";
    }
    @Override public void onProviderDisabled(String provider){latest=null;store.closeSegments();active=null;status="GPS avstängd i telefonen. Slå på platstjänster för att lägga till punkter.";}
    @Override public void onProviderEnabled(String provider){status="Väntar på ny GPS-position…";}
    @Override public void onStatusChanged(String provider,int status,Bundle extras){}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){
        watchdog.removeCallbacks(checkFix);
        if(manager!=null)manager.removeUpdates(this);
        if(store!=null){store.closeSegments();store.close();}
        running=false;active=null;latest=null;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();
    }
}

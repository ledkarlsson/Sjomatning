package se.sjomatning.mobile;



import android.Manifest;

import android.app.Activity;

import android.content.*;

import android.content.pm.PackageManager;

import android.graphics.Color;

import android.graphics.Typeface;

import android.graphics.drawable.GradientDrawable;

import android.location.Location;

import android.net.Uri;

import android.os.*;

import android.text.InputType;

import android.view.*;

import android.widget.*;

import java.time.Instant;

import java.time.ZoneId;

import java.time.format.DateTimeFormatter;

import java.util.*;

import java.util.concurrent.*;



public final class MainActivity extends Activity {

    private final Handler handler=new Handler(Looper.getMainLooper());

    private final ExecutorService network=Executors.newSingleThreadExecutor();

    private SurveyStore store;private LinearLayout root,pointList;private TextView position,result,pointFeedback;private EditText name,depth;

    private int pointLimit=50;private String pointSignature="";

    private ChartView chart;
    private AccessSession access;

    private Button point,sync;private boolean syncing=false,permissionRequested=false;

    private final Runnable refresh=new Runnable(){@Override public void run(){render();handler.postDelayed(this,1000);}};

    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}

    private TextView text(LinearLayout parent,String value,int size,boolean bold){TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(Color.rgb(20,52,61));view.setPadding(0,dp(5),0,dp(5));if(bold)view.setTypeface(null,Typeface.BOLD);parent.addView(view);return view;}

    private LinearLayout card(){LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(18),dp(14),dp(18),dp(14));GradientDrawable bg=new GradientDrawable();bg.setColor(Color.WHITE);bg.setCornerRadius(dp(16));card.setBackground(bg);LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.setMargins(0,0,0,dp(14));root.addView(card,params);return card;}

    private EditText input(LinearLayout parent,String label,String hint,int type){text(parent,label,14,true);EditText field=new EditText(this);field.setHint(hint);field.setInputType(type);field.setSingleLine(true);field.setTextSize(18);parent.addView(field,new LinearLayout.LayoutParams(-1,dp(56)));return field;}

    private Button button(LinearLayout parent,String label,Runnable action){Button button=new Button(this);button.setText(label);button.setAllCaps(false);button.setTextSize(16);parent.addView(button,new LinearLayout.LayoutParams(-1,dp(56)));button.setOnClickListener(v->action.run());return button;}

    @Override public void onCreate(Bundle state){

        super.onCreate(state);access=new AccessSession(this);store=new SurveyStore(this);if(!SurveyService.running)store.closeSegments();

        getWindow().setStatusBarColor(Color.rgb(18,62,76));getWindow().setNavigationBarColor(Color.rgb(234,241,242));

        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(Color.rgb(234,241,242));root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(16),dp(20),dp(16),dp(24));scroll.addView(root);setContentView(scroll);

        scroll.setOnApplyWindowInsetsListener((view,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);}return insets;});

        text(root,"SJÖMÄTNING / GPS",25,true);

        LinearLayout location=card();text(location,"Sjökarta",20,true);chart=new ChartView(this,access);location.addView(chart,new LinearLayout.LayoutParams(-1,dp(300)));position=text(location,"Ingen position",15,false);

        LinearLayout capture=card();text(capture,"Lägg till en punkt i taget",20,true);

        name=input(capture,"Namn på mätningen","Till exempel Roxen – Granholmen",InputType.TYPE_CLASS_TEXT);name.setText("Mätning");

        depth=input(capture,"Manuellt djup (meter)","4,2",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);


        point=button(capture,"＋ Lägg till punkt här",()->capture(SurveyService.POINT));

        pointFeedback=text(capture,"",14,true);

        pointFeedback.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);

        pointList=card();

        LinearLayout cloud=card();text(cloud,"Synka till webben",20,true);


        text(cloud,"Synkar punkter, ändringar och borttagningar till ditt bibliotek. Utan internet sparas allt i telefonen: synka när du har täckning.",14,false);

        sync=button(cloud,"Synka punkter",this::sync);result=text(cloud,"Inget har skickats ännu.",15,false);

        button(cloud,"Öppna webbkartan",()->startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(CloudSync.ORIGIN))));

        if(state!=null){permissionRequested=state.getBoolean("permissionRequested",false);name.setText(state.getString("name","Mätning"));depth.setText(state.getString("depth",""));}

    }

    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);out.putBoolean("permissionRequested",permissionRequested);out.putString("name",name.getText().toString());out.putString("depth",depth.getText().toString());}

    private void startGps(){

        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){

            ArrayList<String> permissions=new ArrayList<>(Arrays.asList(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION));

            if(Build.VERSION.SDK_INT>=33)permissions.add(Manifest.permission.POST_NOTIFICATIONS);

            permissionRequested=true;requestPermissions(permissions.toArray(new String[0]),10);return;

        }command(SurveyService.GPS);

    }

    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==10){if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)command(SurveyService.GPS);else result.setText("Exakt plats behövs. Tillåt den i appens platsbehörighet och öppna appen igen.");}}

    private void command(String action){try{Intent intent=new Intent(this,SurveyService.class).setAction(action);if(SurveyService.STOP.equals(action)&&!SurveyService.running)return;startForegroundService(intent);}catch(RuntimeException e){result.setText("Kunde inte starta GPS: "+e.getMessage());}}

    private void capture(String action){

        try{double value=SurveyFormat.depth(depth.getText().toString());if(!SurveyService.running||!SurveyService.fresh(SurveyService.latest))throw new IllegalArgumentException("Vänta på en färsk, noggrann position.");

            Intent intent=new Intent(this,SurveyService.class).setAction(action).putExtra("depth",value).putExtra("name",name.getText().toString().trim());startForegroundService(intent);

            pointFeedback.setText("Sparar…");

            ((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(depth.getWindowToken(),0);

            handler.postDelayed(()->{if(!isDestroyed()){render();pointFeedback.setText(SurveyService.status);}},150);

        }catch(RuntimeException e){pointFeedback.setText(e.getMessage());}

    }

    private void sync(){

        if(syncing)return;access.require(this::syncAuthenticated,()->{});
    }
    private void syncAuthenticated(String key){
        if(syncing)return;

        syncing=true;render();sync.setEnabled(false);result.setText("Ansluter till webblagringen…");

        network.execute(()->{

            String message;

            try(SurveyStore backgroundStore=new SurveyStore(getApplicationContext())){message=new CloudSync().sync(backgroundStore,key,value->handler.post(()->{if(!isDestroyed())result.setText(value);}));}

            catch(Exception e){if(e instanceof AccessSession.InvalidKeyException){handler.post(()->{syncing=false;if(!isDestroyed()){sync.setEnabled(true);render();access.require(this::syncAuthenticated,()->{});}});return;}message="Synkningen misslyckades: "+e.getMessage()+"\nAlla punkter finns kvar i telefonen. Försök igen.";}

            String finalMessage=message;handler.post(()->{syncing=false;if(!isDestroyed()){sync.setEnabled(true);result.setText(finalMessage);render();}});

        });

    }

    private void render(){

        if(isDestroyed())return;Location fix=SurveyService.latest;boolean ready=SurveyService.fresh(fix);


        position.setText(fix==null?"Ingen position":String.format(Locale.getDefault(),"%.6f, %.6f\nNoggrannhet ±%.0f m · %s",fix.getLatitude(),fix.getLongitude(),fix.getAccuracy(),ready?"aktuell":"väntar på bättre GPS"));

        chart.position(fix,ready);point.setEnabled(ready&&SurveyService.running&&!syncing);

        renderPoints();

    }

    private void renderPoints(){

        List<SurveyStore.Point> points=store.points(pointLimit+1);

        StringBuilder values=new StringBuilder().append(pointLimit).append(syncing);for(SurveyStore.Point p:points)values.append(p.id).append(":").append(p.depth).append(":").append(p.lat).append(":").append(p.lon);String signature=values.toString();

        if(signature.equals(pointSignature))return;pointSignature=signature;pointList.removeAllViews();

        text(pointList,"Sparade punkter · senaste först",20,true);

        if(points.isEmpty())text(pointList,"Ingen punkt ännu.",15,false);

        DateTimeFormatter date=DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss",Locale.getDefault()).withZone(ZoneId.systemDefault());

        for(int i=0;i<Math.min(pointLimit,points.size());i++){

            SurveyStore.Point p=points.get(i);

            text(pointList,String.format(Locale.getDefault(),"#%d · %.2f m · %s",p.id,p.depth,p.name),17,true);

            text(pointList,date.format(Instant.ofEpochMilli(p.time))+String.format(Locale.getDefault(),"\nLat %.6f · Lon %.6f",p.lat,p.lon),14,false);

            Button edit=button(pointList,"Ändra punkt #"+p.id,()->editPoint(p));edit.setEnabled(!syncing);

            Button delete=button(pointList,"Ta bort punkt #"+p.id,()->deletePoint(p));delete.setEnabled(!syncing);

        }

        if(points.size()>pointLimit)button(pointList,"Visa 50 äldre punkter",()->{pointLimit+=50;renderPoints();});

    }

    private double decimal(EditText field){try{return Double.parseDouble(field.getText().toString().trim().replace(',','.'));}catch(NumberFormatException e){throw new IllegalArgumentException("Ange ett giltigt tal.");}}

    private void editPoint(SurveyStore.Point p){

        if(syncing)return;

        LinearLayout fields=new LinearLayout(this);fields.setOrientation(LinearLayout.VERTICAL);fields.setPadding(dp(20),dp(8),dp(20),dp(8));

        EditText d=input(fields,"Djup (meter)","",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);d.setText(Double.toString(p.depth));

        int coordinateType=InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL|InputType.TYPE_NUMBER_FLAG_SIGNED;

        EditText lat=input(fields,"Latitud","",coordinateType);lat.setText(Double.toString(p.lat));

        EditText lon=input(fields,"Longitud","",coordinateType);lon.setText(Double.toString(p.lon));

        text(fields,"Ursprungligt datum och tid behålls. Ändringen skickas till webben nästa gång du synkar.",14,false);

        TextView error=text(fields,"",14,false);ScrollView scroll=new ScrollView(this);scroll.addView(fields);

        android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(this).setTitle("Ändra punkt #"+p.id).setView(scroll).setNegativeButton("Avbryt",null).setPositiveButton("Spara",null).create();

        dialog.setOnShowListener(v->dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(button->{

            try{if(syncing)throw new IllegalArgumentException("Vänta tills synkningen är klar.");store.editPoint(p.id,decimal(d),decimal(lat),decimal(lon));renderPoints();pointFeedback.setText("Punkt #"+p.id+" ändrad. Synka för att uppdatera webben.");dialog.dismiss();}catch(RuntimeException e){error.setText(e.getMessage());}

        }));dialog.show();

    }

    private void deletePoint(SurveyStore.Point p){

        if(syncing)return;

        new android.app.AlertDialog.Builder(this).setTitle("Ta bort punkt #"+p.id+"?").setMessage("Punkten tas bort från telefonen och från detta kontos webbkopia nästa gång du synkar.").setNegativeButton("Avbryt",null).setPositiveButton("Ta bort",(dialog,which)->{

            if(syncing)return;store.deletePoint(p.id);renderPoints();pointFeedback.setText("Punkt #"+p.id+" borttagen. Synka för att uppdatera webben.");

        }).show();

    }

    @Override protected void onResume(){super.onResume();if(!SurveyService.running&&(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||!permissionRequested))startGps();handler.post(refresh);}

    @Override protected void onPause(){handler.removeCallbacks(refresh);super.onPause();}

    @Override protected void onDestroy(){handler.removeCallbacks(refresh);network.shutdown();chart.destroy();access.close();store.close();super.onDestroy();}

}
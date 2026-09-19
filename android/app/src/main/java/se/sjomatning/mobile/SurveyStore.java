package se.sjomatning.mobile;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public final class SurveyStore extends SQLiteOpenHelper {
    public SurveyStore(Context context){super(context.getApplicationContext(),"survey.db",null,2);setWriteAheadLoggingEnabled(true);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE segments(id TEXT PRIMARY KEY,name TEXT NOT NULL,depth REAL NOT NULL,created INTEGER NOT NULL,closed INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE TABLE points(id INTEGER PRIMARY KEY,segment TEXT NOT NULL,time INTEGER NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,speed REAL,accuracy REAL NOT NULL)");
        db.execSQL("CREATE INDEX points_segment ON points(segment,id)");
        db.execSQL("CREATE TABLE receipts(segment TEXT NOT NULL,user TEXT NOT NULL,remote TEXT NOT NULL,PRIMARY KEY(segment,user))");
        upgradePoints(db);
    }
    private void upgradePoints(SQLiteDatabase db){
        db.execSQL("ALTER TABLE points ADD COLUMN depth REAL");
        db.execSQL("UPDATE points SET depth=(SELECT depth FROM segments WHERE segments.id=points.segment)");
        db.execSQL("CREATE TABLE pending_deletes(user TEXT NOT NULL,remote TEXT NOT NULL,PRIMARY KEY(user,remote))");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){if(oldVersion==1&&newVersion==2)upgradePoints(db);else throw new IllegalStateException("Okänd databasversion");}
    public String start(String name,double depth){
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{db.execSQL("UPDATE segments SET closed=1 WHERE closed=0");String id=UUID.randomUUID().toString();ContentValues row=new ContentValues();row.put("id",id);row.put("name",name);row.put("depth",depth);row.put("created",System.currentTimeMillis());db.insertOrThrow("segments",null,row);db.setTransactionSuccessful();return id;}
        finally{db.endTransaction();}
    }
    public void closeSegments(){getWritableDatabase().execSQL("UPDATE segments SET closed=1 WHERE closed=0");}
    public void add(String id,Location location){ContentValues row=new ContentValues();row.put("segment",id);row.put("time",location.getTime());row.put("lat",location.getLatitude());row.put("lon",location.getLongitude());row.put("accuracy",location.getAccuracy());if(location.hasSpeed())row.put("speed",location.getSpeed()*1.943844492);try(Cursor c=getReadableDatabase().rawQuery("SELECT depth FROM segments WHERE id=?",new String[]{id})){if(!c.moveToFirst())throw new IllegalArgumentException("Punkten saknar mätning");row.put("depth",c.getDouble(0));}getWritableDatabase().insertOrThrow("points",null,row);}
    public List<Segment> list(){
        List<Segment> result=new ArrayList<>();
        try(Cursor c=getReadableDatabase().rawQuery("SELECT s.id,s.name,s.depth,s.created,s.closed,COUNT(p.id),(SELECT COUNT(*) FROM receipts r WHERE r.segment=s.id) FROM segments s LEFT JOIN points p ON s.id=p.segment GROUP BY s.id ORDER BY s.created DESC",null)){
            while(c.moveToNext())result.add(new Segment(c.getString(0),c.getString(1),c.getDouble(2),c.getLong(3),c.getInt(4)==1,c.getInt(5),c.getInt(6)>0));
        }return result;
    }
    public byte[] csv(Segment segment){
        if(!segment.closed)throw new IllegalStateException("Avsluta avsnittet före synkning.");
        StringBuilder csv=new StringBuilder("Datum,Tid,Latitud,Longitud,Fart,Djup\n");
        try(Cursor c=getReadableDatabase().rawQuery("SELECT time,lat,lon,speed,depth FROM points WHERE segment=? ORDER BY id",new String[]{segment.id})){
            while(c.moveToNext())csv.append(SurveyFormat.csvRow(c.getLong(0),c.getDouble(1),c.getDouble(2),c.isNull(3)?null:c.getDouble(3),c.getDouble(4)));
        }return csv.toString().getBytes(StandardCharsets.UTF_8);
    }
    public void receipt(String segment,String user,String remote){
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            db.execSQL("INSERT OR IGNORE INTO pending_deletes(user,remote) SELECT user,remote FROM receipts WHERE segment=? AND user=? AND remote<>?",new Object[]{segment,user,remote==null?"":remote});
            db.delete("receipts","segment=? AND user=?",new String[]{segment,user});
            if(remote!=null){ContentValues row=new ContentValues();row.put("segment",segment);row.put("user",user);row.put("remote",remote);db.insertOrThrow("receipts",null,row);}
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    public List<String> pendingDeletes(String user){
        List<String> result=new ArrayList<>();
        try(Cursor c=getReadableDatabase().rawQuery("SELECT d.remote FROM pending_deletes d WHERE d.user=? AND NOT EXISTS(SELECT 1 FROM receipts r WHERE r.user=d.user AND r.remote=d.remote)",new String[]{user})){while(c.moveToNext())result.add(c.getString(0));}return result;
    }
    public void deletedRemote(String user,String remote){getWritableDatabase().delete("pending_deletes","user=? AND remote=?",new String[]{user,remote});}
    public void editPoint(long id,double depth,double lat,double lon){
        SurveyFormat.depth(Double.toString(depth));
        if(!Double.isFinite(lat)||!Double.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new IllegalArgumentException("Ange giltig latitud (−90 till 90) och longitud (−180 till 180).");
        ContentValues row=new ContentValues();row.put("depth",depth);row.put("lat",lat);row.put("lon",lon);
        if(getWritableDatabase().update("points",row,"id=?",new String[]{Long.toString(id)})!=1)throw new IllegalArgumentException("Punkten finns inte längre.");
    }
    public void deletePoint(long id){getWritableDatabase().delete("points","id=?",new String[]{Long.toString(id)});}
    public List<Point> points(int limit){
        List<Point> result=new ArrayList<>();
        try(Cursor c=getReadableDatabase().rawQuery("SELECT p.id,p.time,p.lat,p.lon,p.depth,s.name FROM points p JOIN segments s ON s.id=p.segment ORDER BY p.id DESC LIMIT ?",new String[]{Integer.toString(limit)})){
            while(c.moveToNext())result.add(new Point(c.getLong(0),c.getLong(1),c.getDouble(2),c.getDouble(3),c.getDouble(4),c.getString(5)));
        }return result;
    }
    public static final class Point {
        public final long id,time;public final double lat,lon,depth;public final String name;
        Point(long id,long time,double lat,double lon,double depth,String name){this.id=id;this.time=time;this.lat=lat;this.lon=lon;this.depth=depth;this.name=name;}
    }
    public static final class Segment {
        public final String id,name;public final double depth;public final long created;public final boolean closed,synced;public final int count;
        Segment(String id,String name,double depth,long created,boolean closed,int count,boolean synced){this.id=id;this.name=name;this.depth=depth;this.created=created;this.closed=closed;this.count=count;this.synced=synced;}
        public String fileName(){return SurveyFormat.fileName(created,name,id);}
    }
}

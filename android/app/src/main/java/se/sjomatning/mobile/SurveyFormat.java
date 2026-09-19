package se.sjomatning.mobile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

public final class SurveyFormat {
    private SurveyFormat() {}
    public static double depth(String text) {
        double value;
        try { value = Double.parseDouble(text.trim().replace(',', '.')); }
        catch (RuntimeException e) { throw new IllegalArgumentException("Ange djup i meter, till exempel 4,2."); }
        if (!Double.isFinite(value) || value < 0 || value > 12000) throw new IllegalArgumentException("Djupet måste vara mellan 0 och 12 000 meter.");
        return value;
    }
    public static boolean validFix(double lat, double lon, double accuracy, long ageMillis) {
        return Double.isFinite(lat) && Math.abs(lat)<=90 && Double.isFinite(lon) && Math.abs(lon)<=180 && Double.isFinite(accuracy) && accuracy>=0 && accuracy<=30 && ageMillis>=0 && ageMillis<=15000;
    }
    public static String csvRow(long timestamp, double lat, double lon, Double speedKnots, double depth) {
        Instant instant=Instant.ofEpochMilli(timestamp);
        String date=DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneOffset.UTC).format(instant);
        String time=DateTimeFormatter.ofPattern("HH:mm:ss.SSS'Z'",Locale.ROOT).withZone(ZoneOffset.UTC).format(instant);
        return date+","+time+","+String.format(Locale.ROOT,"%.7f,%.7f,",lat,lon)+(speedKnots==null?"":String.format(Locale.ROOT,"%.3f",speedKnots))+","+String.format(Locale.ROOT,"%.3f",depth)+"\n";
    }
    public static String fileName(long created,String name,String id) {
        String safe=name.replaceAll("[^\\p{L}\\p{N} _-]","_").trim();
        if(safe.length()>70) safe=safe.substring(0,70);
        if(safe.isEmpty()) safe="Spår";
        return DateTimeFormatter.ofPattern("uuuuMMdd_HHmmss",Locale.ROOT).withZone(ZoneOffset.UTC).format(Instant.ofEpochMilli(created))+"_MANUELL_"+safe+"_"+id.substring(0,8)+".csv";
    }
    public static String sha256(byte[] bytes) throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder value=new StringBuilder();
        for(byte b:digest)value.append(String.format(Locale.ROOT,"%02x",b&255));return value.toString();
    }
}

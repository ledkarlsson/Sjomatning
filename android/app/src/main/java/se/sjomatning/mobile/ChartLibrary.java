package se.sjomatning.mobile;

import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Read-only authenticated access for the bundled chart renderer. Session lives only in memory. */
final class ChartLibrary {
    private volatile String cookie="";
    void login(String key)throws Exception{
        cookie="";HttpsURLConnection c=open("login");
        try{c.setRequestMethod("POST");c.setRequestProperty("Content-Type","application/json");byte[] body=new JSONObject().put("password",key.trim()).toString().getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}if(c.getResponseCode()==401)throw new AccessSession.InvalidKeyException();if(c.getResponseCode()!=200)throw new IOException("Kunde inte logga in. Kontrollera nyckeln.");String header=c.getHeaderField("Set-Cookie");if(header==null)throw new IOException("Session saknas.");cookie=header.split(";",2)[0];}finally{c.disconnect();}
    }
    private HttpsURLConnection open(String path)throws Exception{
        HttpsURLConnection c=(HttpsURLConnection)new URL(CloudSync.ORIGIN+"/api/"+path).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(60000);c.setRequestProperty("Origin",CloudSync.ORIGIN);c.setRequestProperty("Cookie",cookie);return c;
    }
    InputStream read(String path)throws Exception{
        if(!path.equals("files")&&!path.matches("files/[a-f0-9-]{36}/content"))throw new IOException("Otillåten läsning");
        HttpsURLConnection c=open(path);
        try{if(c.getResponseCode()==401)throw new AccessSession.InvalidKeyException();if(c.getResponseCode()!=200)throw new IOException("Kunde inte läsa biblioteket. Logga in igen.");
            return new FilterInputStream(c.getInputStream()){@Override public void close()throws IOException{try{super.close();}finally{c.disconnect();}}};
        }catch(Exception e){c.disconnect();throw e;}
    }
    void clear(){cookie="";}
}

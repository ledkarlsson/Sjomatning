package se.sjomatning.mobile;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Persistent originals. The server creates a new UUID whenever content changes. */
final class LibraryStorage {
    interface Reader { InputStream read(String path) throws Exception; }
    private final File directory;
    LibraryStorage(File root,String key)throws Exception {
        directory=new File(root,SurveyFormat.sha256(key.trim().getBytes(StandardCharsets.UTF_8)));
        if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Kunde inte skapa lokal lagring.");
    }
    boolean available(){return new File(directory,"files.json").isFile();}
    void sync(Reader remote)throws Exception {
        synchronized(LibraryStorage.class){syncLocked(remote);}
    }
    private void syncLocked(Reader remote)throws Exception {
        JSONArray files;
        try(InputStream in=remote.read("files")){files=new JSONArray(text(in));}
        JSONArray charts=new JSONArray();Set<String> keep=new HashSet<>();keep.add("files.json");
        for(int i=0;i<files.length();i++){
            JSONObject file=files.getJSONObject(i);
            if(!file.getString("name").matches("(?i).*\\.(pdf|kap|wci)$"))continue;
            String id=file.getString("id");if(!id.matches("[a-f0-9-]{36}"))throw new IOException("Ogiltigt fil-id.");
            long size=file.getLong("size");if(size<1||size>95L*1024*1024)throw new IOException("Ogiltig filstorlek.");
            File target=new File(directory,id);
            if(!target.isFile()||target.length()!=size){
                try(InputStream in=remote.read("files/"+id+"/content")){save(target,in,size);}
            }
            keep.add(id);charts.put(file);
        }
        byte[] index=charts.toString().getBytes(StandardCharsets.UTF_8);
        save(new File(directory,"files.json"),new ByteArrayInputStream(index),index.length);
        File[] old=directory.listFiles();if(old!=null)for(File file:old)if(!keep.contains(file.getName()))file.delete();
    }
    InputStream read(String path)throws Exception {
        synchronized(LibraryStorage.class){return readLocked(path);}
    }
    private InputStream readLocked(String path)throws Exception {
        if(path.equals("files"))return new FileInputStream(new File(directory,"files.json"));
        if(!path.matches("files/[a-f0-9-]{36}/content"))throw new IOException("Otillåten läsning.");
        String id=path.split("/")[1];
        JSONArray files;try(InputStream in=new FileInputStream(new File(directory,"files.json"))){files=new JSONArray(text(in));}
        for(int i=0;i<files.length();i++)if(id.equals(files.getJSONObject(i).getString("id")))return new FileInputStream(new File(directory,id));
        throw new FileNotFoundException("Filen finns inte i ditt sparade bibliotek.");
    }
    private static String text(InputStream in)throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
        while((n=in.read(buffer))!=-1){if(out.size()+n>16*1024*1024)throw new IOException("Biblioteket är för stort.");out.write(buffer,0,n);}
        return new String(out.toByteArray(),StandardCharsets.UTF_8);
    }
    private static void save(File target,InputStream in,long expected)throws Exception {
        File temporary=new File(target.getPath()+".part");
        try {
            long count=0;try(FileOutputStream out=new FileOutputStream(temporary)){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){count+=n;if(count>expected)throw new IOException("Filen är större än väntat.");out.write(buffer,0,n);}out.getFD().sync();}
            if(count!=expected)throw new IOException("Hämtningen avbröts. Försök synka igen.");
            Files.move(temporary.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        }finally{temporary.delete();}
    }
}

package se.sjomatning.mobile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.junit.*;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class LibraryStorageTest {
    @Rule public TemporaryFolder temp=new TemporaryFolder();
    private static final String ID="11111111-1111-1111-1111-111111111111";
    private String listing="[{\"id\":\""+ID+"\",\"name\":\"Test.pdf\",\"size\":3}]";
    private int downloads;
    private InputStream remote(String path)throws Exception {if(path.equals("files"))return bytes(listing);downloads++;return bytes("pdf");}
    private InputStream bytes(String value){return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));}
    @Test public void originalsSurviveRestartAndAreNotDownloadedAgain()throws Exception {
        LibraryStorage first=new LibraryStorage(temp.getRoot(),"key");first.sync(this::remote);
        LibraryStorage restarted=new LibraryStorage(temp.getRoot(),"key");assertTrue(restarted.available());restarted.sync(this::remote);assertEquals(1,downloads);
        try(InputStream in=restarted.read("files/"+ID+"/content")){assertEquals('p',in.read());}
        assertFalse(new LibraryStorage(temp.getRoot(),"another key").available());
    }
    @Test public void failedSyncPreservesIndexAndSuccessfulDeletionRemovesContent()throws Exception {
        LibraryStorage storage=new LibraryStorage(temp.getRoot(),"key");storage.sync(this::remote);
        try{storage.sync(path->{throw new IOException("offline");});fail();}catch(IOException expected){}
        assertTrue(storage.available());try(InputStream in=storage.read("files/"+ID+"/content")){assertEquals('p',in.read());}
        listing="[]";storage.sync(this::remote);try{storage.read("files/"+ID+"/content");fail();}catch(FileNotFoundException expected){}
    }
    @Test public void interruptedDownloadIsNeverPublished()throws Exception {
        LibraryStorage storage=new LibraryStorage(temp.getRoot(),"key");
        try{storage.sync(path->path.equals("files")?bytes(listing):bytes("p"));fail();}catch(IOException expected){}
        assertFalse(storage.available());storage.sync(this::remote);assertTrue(storage.available());
    }
}

package se.sjomatning.mobile;
import org.junit.Test;
import static org.junit.Assert.*;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
public class SurveyFormatTest {
    @Test public void acceptsSwedishDepthAndZero(){assertEquals(4.2,SurveyFormat.depth("4,2"),0);assertEquals(0,SurveyFormat.depth("0"),0);}
    @Test public void rejectsInvalidDepth(){for(String input:new String[]{"","-1","NaN","Infinity","12001"}){try{SurveyFormat.depth(input);fail(input);}catch(IllegalArgumentException expected){}}}
    @Test public void rejectsStaleAndInaccuratePositions(){assertTrue(SurveyFormat.validFix(58,15,8,2000));assertFalse(SurveyFormat.validFix(58,15,31,2000));assertFalse(SurveyFormat.validFix(58,15,8,16000));assertFalse(SurveyFormat.validFix(Double.NaN,15,8,100));assertFalse(SurveyFormat.validFix(58,15,8,-1));}
    @Test public void csvHasAutomaticUtcDateAndManualDepth(){long time=Instant.parse("2026-09-19T22:03:04.123Z").toEpochMilli();assertEquals("2026-09-19,22:03:04.123Z,58.5200000,15.7000000,,4.200\n",SurveyFormat.csvRow(time,58.52,15.7,null,4.2));}
    @Test public void stableFilenameAndHash()throws Exception{String name=SurveyFormat.fileName(0,"Roxen/a","12345678-xxxx");assertEquals("19700101_000000_MANUELL_Roxen_a_12345678.csv",name);assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",SurveyFormat.sha256("abc".getBytes(StandardCharsets.UTF_8)));}
}

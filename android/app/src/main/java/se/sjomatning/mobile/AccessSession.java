package se.sjomatning.mobile;

import android.app.*;
import android.content.Context;
import java.io.IOException;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

/** Shared credential prompt. Stored in private app storage, excluded from Android backup. */
final class AccessSession {
    interface Validator { void check(String key)throws Exception; }
    static final class InvalidKeyException extends IOException { InvalidKeyException(){super("Nyckeln är ogiltig. Ange en ny.");} }
    private static Context storageContext;
    private final Activity activity;private final Validator validator;private final Executor executor;
    private AlertDialog dialog;
    AccessSession(Activity activity){this(activity,value->{ChartLibrary library=new ChartLibrary();try{library.login(value);}finally{library.clear();}},task->new Thread(task,"library-login").start());}
    AccessSession(Activity activity,Validator validator,Executor executor){this.activity=activity;this.validator=validator;this.executor=executor;storageContext=activity.getApplicationContext();}
    static void invalidate(){if(storageContext!=null)storageContext.getSharedPreferences("web_access",Context.MODE_PRIVATE).edit().remove("key").commit();}
    void require(Consumer<String> action,Runnable cancel){
        String cached=activity.getSharedPreferences("web_access",Context.MODE_PRIVATE).getString("key",null);
        if(cached!=null){executor.execute(()->{try{validator.check(cached);activity.runOnUiThread(()->{if(!activity.isDestroyed())action.accept(cached);});}
            catch(InvalidKeyException error){invalidate();activity.runOnUiThread(()->{if(!activity.isDestroyed())prompt(action,cancel);});}
            catch(Exception error){activity.runOnUiThread(()->{if(activity.isDestroyed())return;cancel.run();new AlertDialog.Builder(activity).setTitle("Kunde inte ansluta").setMessage("Kontrollera internet och försök igen. Din sparade nyckel finns kvar.").setPositiveButton("OK",null).show();});}});return;}
        prompt(action,cancel);
    }
    private void prompt(Consumer<String> action,Runnable cancel){
        if(dialog!=null&&dialog.isShowing())return;
        EditText input=new EditText(activity);input.setSingleLine(true);input.setHint("Personlig webbnyckel");input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);input.setSaveEnabled(false);input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        AlertDialog prompt=new AlertDialog.Builder(activity).setTitle("Logga in").setView(input).setNegativeButton("Avbryt",(d,w)->cancel.run()).setPositiveButton("Fortsätt",null).create();dialog=prompt;
        prompt.setOnCancelListener(d->cancel.run());
        prompt.setOnShowListener(v->prompt.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button->{
            String candidate=input.getText().toString().trim();if(candidate.isEmpty()){input.setError("Ange nyckeln");return;}
            prompt.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);input.setEnabled(false);
            executor.execute(()->{try{validator.check(candidate);activity.runOnUiThread(()->{if(activity.isDestroyed()||!prompt.isShowing())return;if(!activity.getSharedPreferences("web_access",Context.MODE_PRIVATE).edit().putString("key",candidate).commit()){input.setEnabled(true);input.setError("Kunde inte spara nyckeln. Försök igen.");prompt.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);return;}input.setText("");prompt.dismiss();action.accept(candidate);});}
                catch(Exception error){activity.runOnUiThread(()->{if(activity.isDestroyed()||!prompt.isShowing())return;input.setEnabled(true);input.setError(error.getMessage());prompt.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);});}});
        }));prompt.show();
    }
    void close(){if(dialog!=null)dialog.dismiss();dialog=null;}
}

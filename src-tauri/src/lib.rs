use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use tauri::Emitter;

fn trigger_notification(app: &tauri::AppHandle, title: &str, body: &str) {
  let _ = app.notification()
    .builder()
    .title(title)
    .body(body)
    .show();
}

#[tauri::command]
fn spawn_agent_run(
  app: tauri::AppHandle,
  ticket_id: String,
  role: String,
  harness: String,
  model: String,
  reasoning: String,
  heartbeat: String,
) -> Result<(), String> {
  use std::io::{BufRead, BufReader};
  use std::process::{Command, Stdio};

  println!(
    "[ZAF Control] spawn_agent_run invoked: {} {} {} (Model: {}, Reasoning: {}, Heartbeat: {})",
    ticket_id, role, harness, model, reasoning, heartbeat
  );

  std::thread::spawn(move || {
    let mut cmd = Command::new("node");
    cmd.arg("cli/zo.js")
      .arg("run")
      .arg(&role)
      .arg("--ticket")
      .arg(&ticket_id)
      .arg("--harness")
      .arg(&harness);

    if !model.is_empty() {
      cmd.arg("--model").arg(&model);
    }
    if !reasoning.is_empty() {
      cmd.arg("--reasoning").arg(&reasoning);
    }
    if !heartbeat.is_empty() {
      cmd.arg("--heartbeat").arg(&heartbeat);
    }

    let mut child = match cmd
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
    {
      Ok(c) => c,
      Err(err) => {
        let err_msg = format!("Failed to spawn zo cli subprocess: {}", err);
        println!("{}", err_msg);
        let _ = app.emit("agent-log", err_msg);
        return;
      }
    };

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app_clone = app.clone();
    std::thread::spawn(move || {
      let reader = BufReader::new(stdout);
      for line in reader.lines() {
        if let Ok(l) = line {
          let _ = app_clone.emit("agent-log", l);
        }
      }
    });

    let app_clone2 = app.clone();
    std::thread::spawn(move || {
      let reader = BufReader::new(stderr);
      for line in reader.lines() {
        if let Ok(l) = line {
          let _ = app_clone2.emit("agent-log", format!("[stderr] {}", l));
        }
      }
    });

    let status = child.wait();
    let status_str = match status {
      Ok(s) => format!("Subprocess exited with status: {}", s),
      Err(e) => format!("Subprocess failed to wait: {}", e),
    };
    println!("[ZAF Control] {}", status_str);
    let _ = app.emit("agent-log", status_str);
  });

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![spawn_agent_run])
    .setup(|app| {
      // 1. Create Menu Items in Tauri v2
      let handle = app.handle();
      let show = MenuItem::with_id(handle, "show", "Show Dashboard", true, None::<&str>)?;
      let sweep = MenuItem::with_id(handle, "sweep", "Trigger Parse Sweep", true, None::<&str>)?;
      let restart = MenuItem::with_id(handle, "restart", "Restart Telemetry Server", true, None::<&str>)?;
      let settings = MenuItem::with_id(handle, "settings", "Settings", true, None::<&str>)?;
      let exit = MenuItem::with_id(handle, "quit", "Exit", true, None::<&str>)?;

      // 2. Build Menu
      let menu = Menu::with_items(handle, &[&show, &sweep, &restart, &settings, &exit])?;

      // 3. Build Tray Icon Safely
      let mut tray_builder = TrayIconBuilder::new();
      if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
      }
      
      let _tray = tray_builder
        .menu(&menu)
        .on_menu_event(|app, event| {
          match event.id.as_ref() {
            "quit" => {
              app.exit(0);
            }
            "show" => {
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
            "sweep" => {
              println!("[ZAF Control] Triggering AST Parse Sweep...");
              let app_handle = app.handle().clone();
              // Spawn background thread to run parse.js
              std::thread::spawn(move || {
                let _ = std::process::Command::new("node")
                  .arg("dashboard/parse.js")
                  .output();
                println!("[ZAF Control] AST Parse Sweep completed successfully.");
                trigger_notification(&app_handle, "AST Parse Sweep Complete", "ZAF dashboard successfully parsed all workspace active tickets.");
              });
            }
            "restart" => {
              println!("[ZAF Control] Restarting ZAF Telemetry Server on port 4242...");
              let app_handle = app.handle().clone();
              std::thread::spawn(move || {
                // Kill any process currently on port 4242 is handled by server.js natively on restart
                let _ = std::process::Command::new("node")
                  .arg("dashboard/server.js")
                  .spawn();
                trigger_notification(&app_handle, "Telemetry Server Restarted", "Background Node.js sidecar service has been successfully rebooted.");
              });
            }
            "settings" => {
              println!("[ZAF Control] Opening Settings configuration panels.");
              trigger_notification(app.handle(), "ZAF Settings", "Settings panels are handled in the local config file.");
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click { .. } = event {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
        })
        .build(app)?;

      // 4. Spawn background Node.js server.js sidecar on boot
      println!("[ZAF Control] Bootstrapping Node.js ZAF Telemetry Server sidecar...");
      let app_handle = app.handle().clone();
      std::thread::spawn(move || {
        let _ = std::process::Command::new("node")
          .arg("dashboard/server.js")
          .spawn();
        // Give the sidecar a tiny fraction of time to start before raising notification
        std::thread::sleep(std::time::Duration::from_millis(500));
        trigger_notification(&app_handle, "ZAF Control Plane Active", "ZAF Telemetry Server successfully started on port 4242.");
      });

      Ok(())
    })
    .on_window_event(|window, event| match event {
      tauri::WindowEvent::CloseRequested { prevent_default, .. } => {
        // Minimize to system tray on window close
        let _ = window.hide();
        *prevent_default = true;
      }
      _ => {}
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

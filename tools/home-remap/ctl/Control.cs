// Home-button remap helper for Samsung The Frame (Tizen 6.5, armv7/32-bit).
//
// There is no public web-app API for assigning the remote's Home button. On a
// TV in Developer Mode this helper runs as the SDK user (UID 901, no root) and
// uses platform C APIs to point the "main" app-control operation and the
// db/appfw/home_appid preference at your launcher. That is what the physical
// Home button resolves to.
//
// It writes only those two values, reads each back, refuses to run unless the
// live state matches the baseline you captured, and auto-rolls-back on any
// failure. `restore` puts your baseline back.
//
// BEFORE BUILDING: set Firmware to YOUR TV's exact version string (run
// ../inspect.sh first; it prints `Version=...`). The guard refuses to touch a
// TV whose firmware you have not vouched for. Target is this repo's app id.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

class Control {
  // ---- EDIT THESE TWO before you build ----
  const string Firmware = "SET-YOUR-FIRMWARE-STRING";   // e.g. "T-PTMUABC-1720.7" from inspect.sh
  const string Target   = "GlassHome1.GlassHome";       // the app the Home button should open
  // -----------------------------------------

  const string Operation = "http://tizen.org/appcontrol/operation/main";
  const string HomeKey   = "db/appfw/home_appid";

  [DllImport("libbundle.so.0")] static extern IntPtr bundle_create();
  [DllImport("libbundle.so.0")] static extern void bundle_free(IntPtr b);
  [DllImport("libaul.so.0")] static extern int aul_svc_set_operation(IntPtr b, string op);
  [DllImport("libaul.so.0")] static extern int aul_get_default_app(IntPtr b, out IntPtr app);
  [DllImport("libapp-context-manager-common.so")] static extern byte util_is_appbooting_supported_webapp_byappid(string app);
  [DllImport("libcapi-appfw-app-operation-tv.so.0")] static extern int app_operation_set_current_app(string op, string app);
  [DllImport("libvconf.so.0")] static extern int vconf_set_str(string key, string value);
  [DllImport("libvconf.so.0")] static extern IntPtr vconf_get_str(string key);
  [DllImport("libc")] static extern uint getuid();
  [DllImport("libc")] static extern void free(IntPtr ptr);

  public class Snapshot {
    public string HomeOperation { get; set; }
    public string HomeAppid { get; set; }
    public int BootSupported { get; set; }
    public uint Uid { get; set; }
  }

  static string ReadVconf(string key) {
    IntPtr p = vconf_get_str(key);
    if (p == IntPtr.Zero) throw new Exception("Cannot read " + key);
    try { return Marshal.PtrToStringAnsi(p); } finally { free(p); }
  }
  static string ReadHomeOp() {
    IntPtr b = bundle_create();
    if (b == IntPtr.Zero) throw new Exception("bundle_create failed");
    try {
      if (aul_svc_set_operation(b, Operation) != 0) throw new Exception("Cannot set main operation for read");
      IntPtr app;
      if (aul_get_default_app(b, out app) != 0 || app == IntPtr.Zero) throw new Exception("Cannot read default main app");
      try { return Marshal.PtrToStringAnsi(app); } finally { free(app); }
    } finally { bundle_free(b); }
  }
  static Snapshot Query() {
    return new Snapshot {
      HomeOperation = ReadHomeOp(), HomeAppid = ReadVconf(HomeKey),
      BootSupported = util_is_appbooting_supported_webapp_byappid(Target), Uid = getuid()
    };
  }
  static void SetHomeOp(string app) {
    if (app_operation_set_current_app(Operation, app) != 0 || ReadHomeOp() != app)
      throw new Exception("Home-operation write/readback failed for " + app);
  }
  static void SetHomeAppid(string app) {
    if (vconf_set_str(HomeKey, app) != 0 || ReadVconf(HomeKey) != app)
      throw new Exception("home_appid write/readback failed for " + app);
  }
  static void Guards() {
    if (IntPtr.Size != 4) throw new Exception("Expected a 32-bit process; stopped");
    if (getuid() != 901) throw new Exception("Expected UID 901 (SDK user); stopped");
    if (Firmware == "SET-YOUR-FIRMWARE-STRING")
      throw new Exception("Set the Firmware constant in Control.cs before building; stopped");
    string prd = File.ReadAllText("/etc/prd_info.ini");
    if (prd.IndexOf(Firmware, StringComparison.Ordinal) < 0)
      throw new Exception("Firmware guard mismatch (want " + Firmware + "); stopped");
  }

  static int Main(string[] args) {
    try {
      Guards();
      string mode = args.Length >= 1 ? args[0] : "query";
      string baselineArg = args.Length >= 2 ? args[1] : null;
      if (mode == "query") { Console.WriteLine("GHHOME_JSON=" + JsonSerializer.Serialize(Query())); return 0; }
      if (mode != "apply" && mode != "restore") throw new Exception("Use: query | apply <baseline.json> | restore <baseline.json>");
      if (baselineArg == null) throw new Exception(mode + " needs the baseline JSON path");

      var baseline = JsonSerializer.Deserialize<Snapshot>(File.ReadAllText(baselineArg));
      if (baseline == null || string.IsNullOrWhiteSpace(baseline.HomeOperation) || string.IsNullOrWhiteSpace(baseline.HomeAppid))
        throw new Exception("Invalid baseline file");
      var before = Query();

      if (mode == "restore") {
        if (before.HomeOperation != baseline.HomeOperation && before.HomeOperation != Target)
          throw new Exception("Home operation is neither your baseline nor " + Target + "; stop and inspect");
        SetHomeOp(baseline.HomeOperation); SetHomeAppid(baseline.HomeAppid);
        Console.WriteLine("GHHOME_RESTORED=" + JsonSerializer.Serialize(Query())); return 0;
      }
      // apply
      if (before.HomeOperation != baseline.HomeOperation || before.HomeAppid != baseline.HomeAppid)
        throw new Exception("Live values changed since baseline; refusing to stack. Inspect first.");
      if (before.BootSupported == 0 || !Directory.Exists("/opt/usr/apps/GlassHome1"))
        throw new Exception("Launcher not eligible (BootSupported=" + before.BootSupported + "); stopped");
      try {
        SetHomeOp(Target); SetHomeAppid(Target);
        Console.WriteLine("GHHOME_APPLIED=" + JsonSerializer.Serialize(Query())); return 0;
      } catch (Exception apply) {
        try { SetHomeOp(baseline.HomeOperation); SetHomeAppid(baseline.HomeAppid);
          Console.Error.WriteLine("GHHOME_APPLY_FAILED_ROLLED_BACK=" + apply.Message); }
        catch (Exception rb) { Console.Error.WriteLine("URGENT: apply failed AND rollback failed: " + apply.Message + " | " + rb.Message); }
        return 1;
      }
    } catch (Exception ex) { Console.Error.WriteLine("GHHOME_ABORTED=" + ex); return 1; }
  }
}

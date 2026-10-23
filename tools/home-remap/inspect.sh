set -u
printf 'GHHOME_INSPECT_BEGIN\n'
id
uname -m
printf 'LONG_BIT=%s\n' "$(getconf LONG_BIT 2>/dev/null)"
printf '\nFIRMWARE\n'
sed -n '/^Version=/p;/^Model=/p' /etc/prd_info.ini 2>/dev/null
cat /etc/tizen-release 2>/dev/null
printf '\nHOME_PREFERENCES\n'
for k in db/appfw/home_appid db/appfw/startup_appid db/appfw/booting_appid_backup db/first_screen/type db/menu/smart_hub/ontvsetting/auto_start; do
  printf '%s = ' "$k"; vconftool get "$k" 2>&1
done
printf '\nDOTNET\n'
ls -d /usr/share/dotnet/shared/Microsoft.NETCore.App/* 2>/dev/null || true
ls /usr/bin/dotnet 2>/dev/null || true
printf '\nNATIVE_LIBRARIES\n'
ls -l /usr/lib/libapp-context-manager-common.so /usr/lib/libcapi-appfw-app-operation-tv.so.0 /usr/lib/libvconf.so.0 /usr/lib/libaul.so.0 /usr/lib/libbundle.so.0 2>/dev/null || true
printf '\nLAUNCHER_PATHS\n'
ls -d /opt/usr/apps/GlassHome1 /opt/usr/home/owner/apps_rw/GlassHome1 2>/dev/null || echo "(GlassHome1 not found in the common install paths)"
printf 'GHHOME_INSPECT_END\n'

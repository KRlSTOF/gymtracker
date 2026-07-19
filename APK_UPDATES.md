# One-time Android signing setup

Android only installs an APK as an update when its package ID and signing key match the installed app and its version code is higher. The workflow now keeps the existing package ID (`com.gymtracker.app`), signs every release with the same private key, and uses the GitHub Actions run number as the version code.

Run this once in the repository's GitHub Codespace. Choose strong passwords and keep a private backup of `gymtracker-release.jks`; losing it means future APKs cannot update the installed app.

```bash
keytool -genkeypair -v \
  -keystore gymtracker-release.jks \
  -alias gymtracker \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

base64 -w 0 gymtracker-release.jks > gymtracker-release.jks.base64
gh secret set GYMTRACKER_KEYSTORE_BASE64 < gymtracker-release.jks.base64
gh secret set GYMTRACKER_KEY_ALIAS --body "gymtracker"
gh secret set GYMTRACKER_KEYSTORE_PASSWORD
gh secret set GYMTRACKER_KEY_PASSWORD
```

Enter the passwords when `gh` prompts. Then move both keystore files somewhere private and delete the Codespace copies. Never commit either file.

Before the first install, export a full backup from the current app because uninstalling it deletes its local data. The first APK produced with this permanent key cannot update an APK signed by an older temporary debug key, so uninstall the current app once and install the new `gymtracker-apk` artifact. Import your backup, then later artifacts will install as updates without deleting app data.

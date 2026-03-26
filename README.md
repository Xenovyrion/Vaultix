# Vaultix — Gestionnaire de mots de passe

> Application de bureau sécurisée pour gérer vos mots de passe, construite avec **Tauri 2**, **Rust** et **React/TypeScript**.

---

## Fonctionnalités

### Sécurité
- **Chiffrement AES-256-GCM** avec authentification intégrée (AEAD)
- **Dérivation de clé Argon2id** résistante aux attaques GPU/ASIC et rainbow tables (paramètres KDF configurables)
- **Compression gzip** des données avant chiffrement (optionnelle)
- **Vérification des fuites** via l'API HaveIBeenPwned (k-anonymat — le mot de passe ne quitte jamais l'appareil)
- **Verrouillage automatique** après inactivité configurable
- Effacement du presse-papiers automatique après délai configurable

### Authentification
- Mot de passe maître (avec changement et réinitialisation)
- **Biométrie / Windows Hello** (empreinte, visage, code PIN) via le Credential Manager Windows
- **TOTP** (Google Authenticator, Authy, Microsoft Authenticator…) avec QR code
- Prompt d'activation de la 2FA dès la création d'une nouvelle base

### Gestion des entrées
- Types d'entrées : Web, RDP, SSH, FTP, base de données, carte bancaire, note sécurisée…
- Champs : titre, identifiant, mot de passe, URL, notes, tags, TOTP, favori, date d'expiration
- **Historique complet** de chaque champ modifié (mot de passe, login, URL…) avec horodatage
- **Indicateur d'entropie** du mot de passe en bits
- **Indicateur de force** visuel (5 niveaux)
- Codes TOTP live avec compte à rebours
- Ouverture des URL avec le protocole adapté (http, rdp, ssh, ftp…)
- Glisser-déposer pour réordonner les entrées
- Menu contextuel (clic droit)

### Générateur de mots de passe
- **Mode jeu de caractères** : longueur 4–128, majuscules, minuscules, chiffres, symboles, exclusion des ambigus, caractères personnalisés
- **Mode phrase secrète** : 2–12 mots, séparateur, capitalisation, ajout de nombre/symbole
- **Mode motif** : `x`=minuscule, `X`=majuscule, `d`=chiffre, `s`=symbole, `*`=aléatoire, `\c`=littéral
- Entropie affichée en bits (barre de progression + label coloré)

### Interface
- 13 thèmes intégrés : Sombre, Clair, Nord, Dracula, Catppuccin, Océan, Forêt, Tokyo Night, Solarized, Gruvbox, Monokai, Rose Pine, Solarized Clair
- Personnalisation complète des couleurs (color picker en temps réel)
- Tags avec couleurs personnalisables
- Icône dans le système tray (fermer = minimiser, pas quitter)
- Raccourcis clavier entièrement configurables

### Sauvegarde
- Sauvegarde automatique configurable (locale, réseau UNC, lecteur cloud monté)
- Fréquence paramétrable (30 min, 1 h, 6 h, 12 h, 24 h, hebdomadaire)
- Nombre maximum de sauvegardes avec rotation automatique
- Nommage personnalisable (`{date}_{time}_{name}`)

### Mises à jour
- Vérification automatique des nouvelles versions via GitHub Releases
- Notification non intrusive avec notes de version
- Installation en un clic + redémarrage automatique

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | React 18 + TypeScript |
| Backend | Rust (Tauri 2) |
| Chiffrement | AES-256-GCM (`aes-gcm`) |
| KDF | Argon2id (`argon2`) |
| TOTP | `totp-rs` |
| Biométrie | `keyring` (Windows Credential Manager) |
| Mises à jour | `tauri-plugin-updater` + GitHub Releases |
| Interface | CSS custom (variables CSS, pas de framework UI) |
| QR Code | `qrcode.react` |

---

## Prérequis

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://rustup.rs/) (stable, dernière version)
- Windows 10/11 (support macOS prévu)

---

## Installation & développement

```bash
# Cloner le dépôt
git clone https://github.com/LordLuffy/LockSafe.git
cd LockSafe

# Installer les dépendances JavaScript
npm install

# Lancer en mode développement (hot-reload)
npm run tauri dev
```

## Build de production

```bash
npm run tauri build
```

L'installateur se trouve dans `src-tauri/target/release/bundle/nsis/`.

---

## Publier une release

### Première fois — Configuration unique

Ces étapes sont à faire **une seule fois** avant d'envoyer la première release.

#### 1. Générer la paire de clés de signature

Dans le terminal, depuis n'importe quel dossier :

```bash
npx tauri signer generate -w ~/.tauri/vaultix.key
```

La commande génère :
- **`~/.tauri/vaultix.key`** — clé privée (NE JAMAIS committer, NE JAMAIS partager)
- **Une clé publique** affichée dans le terminal, de la forme :
  ```
  Public key: dW50cnVzdGVkIGNvbW1lbnQ6...
  ```

#### 2. Mettre la clé publique dans `tauri.conf.json`

Dans `src-tauri/tauri.conf.json`, remplacer la valeur de `pubkey` :

```json
"plugins": {
  "updater": {
    "pubkey": "COLLER_LA_CLE_PUBLIQUE_ICI",
    "endpoints": ["https://github.com/LordLuffy/LockSafe/releases/latest/download/latest.json"]
  }
}
```

Committer ce changement (`pubkey` est publique, elle peut aller dans le repo).

#### 3. Ajouter les secrets dans GitHub

Sur [github.com/LordLuffy/LockSafe](https://github.com/LordLuffy/LockSafe) :
**Settings → Secrets and variables → Actions → New repository secret**

| Nom du secret | Valeur |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contenu complet du fichier `~/.tauri/vaultix.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Mot de passe choisi lors du `generate` |

---

### Chaque release — Étapes standard

#### 1. Vérifier la version

S'assurer que les deux fichiers indiquent la même version :

```
src-tauri/tauri.conf.json  →  "version": "1.0.1"
src-tauri/Cargo.toml       →  version = "1.0.1"
```

#### 2. Committer tous les changements

```bash
git add .
git commit -m "Release v1.0.1"
```

#### 3. Créer et pousser le tag

```bash
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

#### 4. GitHub Actions fait le reste

Le workflow `.github/workflows/release.yml` se déclenche automatiquement et :
1. Compile l'application en mode release
2. Signe les artefacts avec ta clé privée (depuis les secrets GitHub)
3. Génère `latest.json` (endpoint utilisé par le système de mise à jour)
4. Crée la release GitHub avec tous les fichiers attachés

La release est visible sur : [github.com/LordLuffy/LockSafe/releases](https://github.com/LordLuffy/LockSafe/releases)

> **Les utilisateurs existants** recevront une notification de mise à jour au prochain démarrage de l'application.

---

## Structure du projet

```
Vaultix/
├── .github/
│   └── workflows/
│       └── release.yml               # CI/CD — build + sign + release automatique
├── src/                              # Frontend React/TypeScript
│   ├── components/
│   │   ├── SetupScreen.tsx           # Création / ouverture d'une base
│   │   ├── UnlockScreen.tsx          # Déverrouillage
│   │   ├── SecuritySetupScreen.tsx   # Configuration 2FA post-création
│   │   ├── Vault.tsx                 # Vue principale du coffre
│   │   ├── EntryPanel.tsx            # Panneau de détail / édition d'une entrée
│   │   ├── GeneratorModal.tsx        # Générateur de mots de passe
│   │   ├── SettingsPanel.tsx         # Paramètres (thème, sécurité, sauvegarde…)
│   │   └── UpdateBanner.tsx          # Bannière de notification de mise à jour
│   ├── hooks/
│   │   └── useSettings.ts            # Gestion des paramètres (localStorage)
│   ├── utils/
│   │   ├── recentDbs.ts              # Bases récentes (localStorage)
│   │   └── protocol.ts               # Détection et ouverture des protocoles URL
│   ├── themes.ts                     # Définition des 13 thèmes
│   └── types.ts                      # Types TypeScript partagés
├── src-tauri/                        # Backend Rust
│   ├── src/
│   │   ├── lib.rs                    # Commandes Tauri (invoke handlers)
│   │   ├── database.rs               # Logique de chiffrement / stockage
│   │   ├── generator.rs              # Générateur de mots de passe
│   │   └── updater.rs                # Commandes de mise à jour (check + install)
│   ├── icons/
│   │   └── LockSafe.ico
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

---

## Sécurité

- La base de données est un fichier `.kv` chiffré — sans le mot de passe maître, les données sont **irrécupérables**
- Le mot de passe maître ne quitte jamais la mémoire vive et est effacé (`zeroize`) lors du verrouillage
- La vérification des fuites (HIBP) utilise le **k-anonymat** : seuls les 5 premiers caractères du hash SHA-1 sont envoyés, jamais le mot de passe en clair
- La biométrie Windows Hello chiffre le mot de passe maître dans le **Credential Manager** de Windows, protégé par la puce TPM
- Les mises à jour sont **signées cryptographiquement** — impossible d'installer un artefact non signé par la clé privée du projet

---

## Paramètres recommandés

| Paramètre | Valeur recommandée |
|-----------|-------------------|
| KDF Mémoire | 64 MiB (256 MiB pour usage haute sécurité) |
| KDF Itérations | 3 (6+ pour usage haute sécurité) |
| Verrouillage auto | 15–60 minutes |
| Sauvegarde | Quotidienne, 10 copies max |
| Entropie mot de passe | ≥ 80 bits (objectif : 128+ bits) |

---

## Licence

Ce projet est distribué sous licence **MIT**. Voir le fichier [LICENSE](LICENSE) pour les détails.

---

## Contribuer

Les contributions sont les bienvenues. Ouvrez une issue ou une pull request.

1. Fork le projet
2. Créez votre branche : `git checkout -b feature/ma-fonctionnalite`
3. Committez vos changements : `git commit -m "feat: ma fonctionnalité"`
4. Pushez la branche : `git push origin feature/ma-fonctionnalite`
5. Ouvrez une Pull Request

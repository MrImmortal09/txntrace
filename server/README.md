# TxnTrace Server

A single deployable FastAPI app: it serves both the statement-import web UI and the JSON API the mobile app syncs from. No separate frontend build or deployment — this is the whole thing.

- Upload a PDF/CSV/Excel bank statement, review the parsed rows, import them.
- Browse all transactions; click one for full details (date, bank, reference, balance, raw message, etc.).
- Configure cards/accounts and their credit limits at `/cards` — the mobile app matches incoming SMS against these (last-4 digit or a custom pattern) to tag each transaction with a card.
- The mobile app pulls newly-imported transactions and the card registry from here via **Settings → Sync from Web**.

Storage is Postgres, meant to be a free [Neon](https://neon.tech) project — no local database to run or back up. Set the connection string as `DB` in `server/.env` (see `server/.env.example`).

## Run locally

```sh
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in DB with your Neon connection string
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`. For the phone to sync, it needs to reach this machine's IP (not `localhost`) on the same network — find it with `ipconfig getifaddr en0` (Wi-Fi) on macOS, then enter e.g. `http://192.168.1.10:8000` in the app's Settings screen.

## Statement parsing: generic, not bank-specific

Unlike the mobile app's SMS parsers (tuned against real bank SMS), the statement parser works off column-name and layout heuristics rather than a bank-specific template — matching headers like "Date"/"Narration"/"AMT", handling a single Debit/Credit indicator column as well as separate debit/credit amount columns, an amount with an embedded "Dr./Cr." suffix, non-comma-delimited "CSV" exports, and both modern (openpyxl) and legacy binary (xlrd) Excel formats regardless of what extension the bank gave the file. It has been validated against real HDFC/ICICI/SBI statement exports (CSV, XLS, and legacy XLS) — PDF statement parsing is comparatively weaker, since a PDF with no extractable table loses the information needed to tell which column an amount came from. If a new statement doesn't parse well, the fix is almost always adjusting the header-matching keywords, date formats, or direction-detection heuristic in `app/parsing.py` — send over a real (redacted) sample.

## Deploying to an Oracle Cloud VM

These steps assume an "Always Free" OCI compute instance running Ubuntu, reachable over SSH, with its public IP already known. Commands use `ubuntu` as the login user and `~/txntrace` as the clone path — adjust both if yours differ. (Oracle Linux images use `opc` as the user and `dnf` instead of `apt`; the rest is the same.)

### 1. Open the port — this is the step everyone forgets on OCI

Oracle Cloud blocks everything but SSH by default, at **two** separate layers, and both need a rule or the app is unreachable from outside the VM:

1. **Security List / Network Security Group** (cloud-level firewall): OCI Console → your instance → **Subnet** → **Security List** → **Add Ingress Rule** → Source CIDR `0.0.0.0/0`, destination port `8000` (or whatever port you run on).
2. **OS-level firewall** (Ubuntu OCI images ship with `iptables` rules that also block non-SSH ports out of the box):
   ```sh
   sudo iptables -I INPUT -p tcp --dport 8000 -j ACCEPT
   sudo netfilter-persistent save   # persists across reboots; install via: sudo apt install iptables-persistent
   ```

### 2. Install dependencies and clone the repo

```sh
sudo apt update && sudo apt install -y python3-venv python3-pip git
git clone https://github.com/MrImmortal09/txntrace.git ~/txntrace
cd ~/txntrace/server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Configure the database connection

```sh
cp .env.example .env
nano .env   # set DB=<your Neon connection string>
```

This file is gitignored on purpose — it's created once, by hand, on the VM, and never touched by `git pull` or the deploy pipeline.

### 4. Run it as a systemd service

A service means the app survives reboots and restarts itself if it crashes, instead of dying when your SSH session ends. Copy the template and fill in your actual paths:

```sh
sudo cp ~/txntrace/server/deploy/txntrace.service /etc/systemd/system/txntrace.service
sudo nano /etc/systemd/system/txntrace.service   # check User= and the paths match your setup
sudo systemctl daemon-reload
sudo systemctl enable --now txntrace
sudo systemctl status txntrace   # should show "active (running)"
```

From here, `http://<vm-public-ip>:8000` should be reachable — enter that in the mobile app's Settings → Sync from Web.

## CI/CD: auto-deploy on push to `main`

Yes — `.github/workflows/deploy.yml` SSHes into the VM and redeploys automatically whenever `server/` changes land on `main`. It needs three things set up once, which GitHub Actions can't do on its own:

### 1. A dedicated deploy key (don't reuse your personal SSH key)

On your own machine:
```sh
ssh-keygen -t ed25519 -f txntrace_deploy_key -N "" -C "github-actions-deploy"
```
This makes two files: `txntrace_deploy_key` (private) and `txntrace_deploy_key.pub` (public).

Add the **public** key to the VM:
```sh
ssh-copy-id -i txntrace_deploy_key.pub ubuntu@<vm-public-ip>
```

### 2. Passwordless restart permission for exactly one command

The deploy step needs to restart the service without a sudo password prompt, which won't work in an unattended CI run. Grant that for *only* this one command, not broad sudo access:

```sh
echo "ubuntu ALL=(ALL) NOPASSWD: /bin/systemctl restart txntrace" | sudo tee /etc/sudoers.d/txntrace-deploy
sudo chmod 440 /etc/sudoers.d/txntrace-deploy
```

### 3. GitHub repo secrets

In your repo → **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret | Value |
|---|---|
| `ORACLE_VM_HOST` | the VM's public IP |
| `ORACLE_VM_USER` | `ubuntu` (or `opc` for Oracle Linux) |
| `ORACLE_VM_SSH_KEY` | the full contents of `txntrace_deploy_key` (the **private** key file) |

Once those three secrets exist, every push to `main` that touches `server/` will `git pull`, reinstall dependencies, and restart the service on the VM within about a minute — check progress under the repo's **Actions** tab.

## API

- `POST /api/statements/parse` — multipart file upload, returns parsed rows (not yet saved).
- `POST /api/transactions` — commits `{bank, rows}` to the database; re-importing the same statement is a no-op (rows are deduped by bank+date+amount+type+description).
- `GET /api/transactions` — all transactions, newest first.
- `GET /api/transactions/export?since=<ISO timestamp>` — transactions created after `since`; this is what the mobile app calls.

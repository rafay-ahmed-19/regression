# Set up Evolv Regression Hub on your computer

This guide gets the app running on your own Windows PC or Mac, without Docker. You do not need to
be a developer. Follow the steps in order and copy each command exactly as shown.

**Time needed:** about 30 minutes the first time. After that, starting the app takes under a minute.

## What you will install

| Program | What it is for | Cost |
| --- | --- | --- |
| Visual Studio Code (VS Code) | The window you run the app from | Free |
| Python | Runs the app's server | Free |
| Node.js | Builds the app's screens | Free |
| MongoDB | The database where the app keeps its own data (suites, baselines, run history) | Free |

You do **not** need to install anything for Oracle. The app can talk to Oracle databases by itself;
see Part 6.

You install these once. You may need administrator rights on your computer; if an installer asks
for a password you do not have, ask your IT team.

---

## Part 1: Install the four programs

### 1. VS Code

1. Go to https://code.visualstudio.com and click **Download**.
2. Open the downloaded file and accept the default options.

### 2. Python

1. Go to https://www.python.org/downloads and download **Python 3.12 or newer**.
2. Open the downloaded file.
3. **Windows only, important:** on the first installer screen, tick **Add python.exe to PATH** at
   the bottom, then click **Install Now**.
4. On Mac, click through the installer with the default options.

### 3. Node.js

1. Go to https://nodejs.org and download the version marked **LTS**.
2. Open the downloaded file and accept the default options.

### 4. MongoDB

**Windows**

1. Go to https://www.mongodb.com/try/download/community.
2. Choose the newest version, platform **Windows**, package **msi**, and click **Download**.
3. Open the file and choose **Complete**.
4. Leave **Install MongoDB as a Service** ticked. This makes the database start by itself every
   time you turn on your PC.
5. You can untick **Install MongoDB Compass**; the app does not need it.

**Mac**

MongoDB on Mac is installed with a helper called Homebrew. Open the **Terminal** app (press
Cmd + Space, type `Terminal`, press Enter) and run these one at a time.

Install Homebrew (skip this if you already have it):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install MongoDB:

```bash
brew tap mongodb/brew
```

```bash
brew install mongodb-community
```

Start MongoDB, now and every time the Mac starts:

```bash
brew services start mongodb-community
```

### Restart your computer

Restart once now. This makes sure every program can find the ones you just installed.

---

## Part 2: Get the app

1. Open https://github.com/rafay-ahmed-19/regression in your browser.
2. Click the green **Code** button, then **Download ZIP**.
3. Open the ZIP and move the folder inside it somewhere easy to find, for example your
   **Documents** folder. Rename it to `regression` if it has a longer name such as
   `regression-main`.

## Part 3: Open the app in VS Code

1. Open VS Code.
2. Click **File → Open Folder…**, pick the `regression` folder and click **Select Folder** (Mac: **Open**).
3. If VS Code asks "Do you trust the authors of the files in this folder?", click **Yes, I trust the authors**.
4. Open a terminal inside VS Code: click **Terminal → New Terminal** in the top menu. A panel
   opens at the bottom. This is where you paste the commands below.

**Windows only:** VS Code opens a terminal type called PowerShell, which can block some commands.
Switch to Command Prompt instead: in the terminal panel, click the small **down arrow next to the
+ button** and choose **Command Prompt**. Use that terminal for everything below.

To paste a command, copy it from this page, click inside the terminal, press **Ctrl + V**
(Mac: **Cmd + V**), then press **Enter**. Wait for each command to finish before pasting the next.

## Part 4: One-time setup

Run these commands once. Pick the Windows or the Mac version of each.

### Step 1: Set up the server

**Windows**

```bash
cd backend
```

```bash
py -m venv .venv
```

```bash
.venv\Scripts\python -m pip install -r requirements.txt
```

**Mac**

```bash
cd backend
```

```bash
python3 -m venv .venv
```

```bash
.venv/bin/python -m pip install -r requirements.txt
```

The last command downloads what the server needs. It prints a lot of text and takes a minute or two.

### Step 2: Build the screens

These are the same on Windows and Mac.

```bash
cd ../frontend
```

```bash
npm install
```

```bash
npm run build
```

When the last command ends with a line containing **built in**, the setup is done.

## Part 5: Start the app

Do this every time you want to use the app.

1. Open VS Code. It reopens the `regression` folder by itself; if not, use **File → Open Folder…**.
2. Open a terminal: **Terminal → New Terminal** (on Windows, choose **Command Prompt** as before).
3. Run:

**Windows**

```bash
cd backend
```

```bash
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

**Mac**

```bash
cd backend
```

```bash
.venv/bin/python -m uvicorn app.main:app --port 8000
```

4. Wait until you see the line **Application startup complete**.
5. Open your browser and go to **http://localhost:8000**

The first time, the app fills itself with two example suites and a history of runs so that you have
something to look at. The [user guide](user-guide.md) explains every screen.

**Keep the terminal open** while you use the app. The app stops when you close it.

## Part 6: Connect the app to your Oracle database

The app checks results by running queries on an Oracle database where your build has already run.

1. **Turn on the company VPN** on this computer, the same way you do for other work tools. The app
   reaches Oracle through your computer's network, so the VPN must be connected whenever you test a
   connection or start a run.
2. In the app, click **Connections** in the left menu, then **Add connection**.
3. Enter the database details: a name of your choice, the host, the port (usually `1521`), the
   service name (or SID), and the Oracle user and password. If you already use SQL Developer or
   Toad, the same values are in your connection there. Otherwise ask your DBA.
4. Click **Test connection**.
   - A green message means it works. Click **Add connection** to save it.
   - A red message tells you what to fix. See the table at the end of this guide.

You only do this once per database. After that, pick the connection in **New run**. The
[user guide](user-guide.md) covers the rest.

**About the password:** it is saved in the app's database on this computer so that you do not have
to retype it. It is never displayed again. Use an Oracle account that can only read data.

## Stop the app

Click inside the terminal and press **Ctrl + C** (also on Mac), or just close VS Code. Your data
stays in the database and is there next time.

---

## Optional: turn on AI failure analysis

The **Analyse failure** button needs a key from Anthropic. Everything else works without it.

1. In VS Code's file list on the left, open the `backend` folder.
2. Right-click `.env.example`, choose **Copy**, then right-click the `backend` folder and choose **Paste**.
3. Rename the copy to exactly `.env`
4. Open `.env` and put your key after `ANTHROPIC_API_KEY=` with no spaces, for example
   `ANTHROPIC_API_KEY=sk-ant-...`
5. Save the file (Ctrl + S), then stop and start the app.

Keep this key private. Do not email it or share the `.env` file.

## Getting a newer version of the app

1. Download the ZIP again (Part 2) and replace your `regression` folder with the new one.
2. Repeat Part 4 (one-time setup). This also installs anything new the app needs.

Your data and your saved Oracle connections are not lost: they live in MongoDB, not in the folder. If you turned on AI analysis, copy
your `.env` file into the new `backend` folder.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| `'py' is not recognized` or `python3: command not found` | Python is not installed, or the PATH box was not ticked. Run the Python installer again, tick **Add python.exe to PATH**, then restart the computer. |
| `'npm' is not recognized` | Node.js is not installed, or the computer was not restarted after installing it. |
| `running scripts is disabled on this system` | The terminal is PowerShell. Switch it to **Command Prompt** (Part 3). |
| The start command waits about 30 seconds, then shows an error mentioning `ServerSelectionTimeoutError` or `localhost:27017` | MongoDB is not running. **Windows:** press Start, type `Services`, open it, find **MongoDB Server**, right-click, **Start**. **Mac:** run `brew services start mongodb-community`. |
| `address already in use` or `only one usage of each socket address` | The app is already running in another terminal. Use that one, or close it first. |
| The browser shows `{"detail":"Not Found"}` | The screens were not built. Run the two commands in Part 4, Step 2 again from the `frontend` folder, then start the app. |
| The browser says the site cannot be reached | The app is not running. Check that the terminal shows **Application startup complete** and that the address is exactly `http://localhost:8000`. |
| Test connection says **Could not reach host:port. Check that the VPN is connected** | The VPN is off, or the host or port is wrong. Connect the VPN and test again. If it still fails, compare the host and port with a connection that works in SQL Developer. |
| Test connection says **Oracle rejected the user name or password** | Retype the password. Check that the account is not locked or expired by logging in with another tool. |
| Test connection says the database **does not know service name** (or **SID**) | The service name or SID is wrong, or you picked the wrong one of the two in **Identify by**. |
| Test connection mentions **Native Network Encryption** | Your database requires a kind of encryption the app's built-in Oracle driver does not support. Ask your DBA whether a TLS (TCPS) connection is available, and tell whoever maintains the app. |
| A run worked earlier but now stops with a VPN message | The VPN disconnected. Reconnect it and click **Run again** on the run. |
| `No module named 'oracledb'` when starting the app | The app was updated but the setup was not repeated. Run the `pip install` command from Part 4, Step 1 again. |
| `No such file or directory` or `cannot find the path` after a `cd` command | The terminal is in the wrong folder. Close it with the bin icon, open a new one (**Terminal → New Terminal**) and start that part again. |

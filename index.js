// index.js - COMPLETE UPDATED CODE WITH PYTHON-STYLE GROUPS LIST
const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const {
    makeInMemoryStore,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    makeWASocket,
    isJidBroadcast,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 5000;

// Create necessary directories
if (!fs.existsSync("sessions")) {
    fs.mkdirSync("sessions");
}
if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads");
}

const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store active client instances and tasks
const activeClients = new Map(); // sessionId -> { client, number, authPath, connected, lastConnected, retryCount }
const activeTasks = new Map();   // taskId -> taskInfo

// Auto-reconnect configuration
const MAX_RETRIES = 1000; // Unlimited retries in practice
const RECONNECT_INTERVAL = 10000; // 10 seconds

// Helper: ensure a proper jid for numbers (assumes full international number without +)
function toNumberJid(number) {
    // If it already includes @, return as is
    if (number.includes("@")) return number;
    // Baileys expects  -> <number>@s.whatsapp.net or <number>@c.us depending on older libs.
    return `${number}@s.whatsapp.net`;
}

// Python-style WhatsApp Client class
class WhatsAppClient {
    constructor() {
        this.activeClient = null;
        this.userInfo = null;
    }

    setClient(client, userInfo) {
        this.activeClient = client;
        this.userInfo = userInfo;
    }

    getLayerInterface() {
        // Mock implementation similar to YowAuthenticationProtocolLayer
        return {
            getUsername: (full) => {
                if (this.userInfo && this.userInfo.id) {
                    return full ? this.userInfo.id : this.userInfo.id.split('@')[0];
                }
                return null;
            }
        };
    }

    assertConnected() {
        return this.activeClient && this.activeClient.connection === 'open';
    }

    _sendIq(entity, successFn, errorFn) {
        // Mock implementation for Baileys
        if (this.assertConnected()) {
            this.activeClient.groupFetchAllParticipating()
                .then(result => successFn(result, entity))
                .catch(error => errorFn(error, entity));
        }
    }

    groups_list() {
        const onGroupsListResult = (successEntity, originalEntity) => {
            const me = this.getLayerInterface().getUsername(true);
            console.log("Current user:", me);
            
            // Convert groups to array and filter by owner (EXACTLY like your Python code)
            const groupsArray = Object.entries(successEntity).map(([jid, group]) => ({
                getId: () => jid,
                getSubject: () => group.subject || 'No Name',
                getOwner: () => group.owner
            }));

            // EXACT Python logic: myGroups = [group for group in successEntity.getGroups() if group.getOwner() == me]
            const myGroups = groupsArray.filter(group => group.getOwner() === me);
            
            console.log("=== OWNED GROUPS (Python-style with owner filter) ===");
            for (const group of myGroups) {
                console.log(group.getId() + '---->' + group.getSubject());
            }
            
            return myGroups;
        };

        const onGroupsListError = (errorEntity, originalEntity) => {
            console.log("Groups list error:", errorEntity);
        };

        if (this.assertConnected()) {
            const entity = {}; // Mock ListGroupsIqProtocolEntity
            const successFn = (successEntity, originalEntity) => onGroupsListResult(successEntity, originalEntity);
            const errorFn = (errorEntity, originalEntity) => onGroupsListError(errorEntity, originalEntity);
            this._sendIq(entity, successFn, errorFn);
        } else {
            console.error("Not connected to WhatsApp");
        }
    }

    // Version without owner filter
    groups_list_all() {
        const onGroupsListResult = (successEntity, originalEntity) => {
            const me = this.getLayerInterface().getUsername(true);
            console.log("Current user:", me);
            
            // Convert groups to array
            const groupsArray = Object.entries(successEntity).map(([jid, group]) => ({
                getId: () => jid,
                getSubject: () => group.subject || 'No Name',
                getOwner: () => group.owner,
                getParticipants: () => group.participants?.length || 0,
                getDescription: () => group.desc || 'No description'
            }));

            // NO FILTER - all groups (removed the owner filter as requested)
            const allGroups = groupsArray;
            
            console.log("=== ALL GROUPS (No owner filter) ===");
            for (const group of allGroups) {
                const isOwner = group.getOwner() === me;
                console.log(group.getId() + '---->' + group.getSubject() + (isOwner ? ' [OWNER]' : ' [MEMBER]'));
            }
            
            return allGroups;
        };

        const onGroupsListError = (errorEntity, originalEntity) => {
            console.log("Groups list error:", errorEntity);
        };

        if (this.assertConnected()) {
            const entity = {};
            const successFn = (successEntity, originalEntity) => onGroupsListResult(successEntity, originalEntity);
            const errorFn = (errorEntity, originalEntity) => onGroupsListError(errorEntity, originalEntity);
            this._sendIq(entity, successFn, errorFn);
        } else {
            console.error("Not connected to WhatsApp");
        }
    }
}

// Initialize the Python-style client handler
const waClientHandler = new WhatsAppClient();

// Enhanced connection handler
async function initializeClient(sessionId, phoneNumber, isReconnect = false) {
    try {
        const sessionPath = path.join("sessions", sessionId);

        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const waClient = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: "fatal" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: true,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => isJidBroadcast(jid),
            getMessage: async key => ({}),
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 1000,
            maxRetries: 10,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
            transactionOpts: {
                maxCommitRetries: 10,
                delayBetweenTriesMs: 3000
            }
        });

        // Save credentials automatically
        waClient.ev.on("creds.update", saveCreds);

        // Enhanced connection update handler
        waClient.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            console.log([sessionId], "Connection update:", connection);

            if (connection === "open") {
                console.log(`✅ WhatsApp CONNECTED for ${phoneNumber} | Session: ${sessionId}`);

                // Update client in active clients
                activeClients.set(sessionId, {
                    client: waClient,
                    number: phoneNumber,
                    authPath: sessionPath,
                    connected: true,
                    lastConnected: new Date(),
                    retryCount: 0
                });

                // Set the client for Python-style handler
                waClientHandler.setClient(waClient, waClient.user);

            } else if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect =
                    statusCode !== DisconnectReason.loggedOut &&
                    statusCode !== 401;

                if (shouldReconnect) {
                    const clientInfo = activeClients.get(sessionId) || {};
                    const retryCount = clientInfo.retryCount || 0;

                    if (retryCount < MAX_RETRIES) {
                        console.log(`🔄 Reconnecting... Attempt ${retryCount + 1} for ${sessionId}`);

                        activeClients.set(sessionId, {
                            ...clientInfo,
                            connected: false,
                            retryCount: retryCount + 1
                        });

                        // Reconnect after delay
                        setTimeout(() => {
                            initializeClient(sessionId, phoneNumber, true)
                                .catch(err => console.error(`Re-init error for ${sessionId}:`, err));
                        }, RECONNECT_INTERVAL);

                    } else {
                        console.log(`❌ Max retries reached for ${sessionId}`);
                    }
                } else {
                    console.log(`❌ Session logged out: ${sessionId}`);
                    activeClients.delete(sessionId);
                }
            }

            // Handle QR code for new connections
            if (qr && !isReconnect) {
                console.log(`📱 QR Code received for ${phoneNumber}`);
                // You might want to emit or save the QR to a file for user to scan.
            }
        });

        // Minimal messages.upsert handler (so Baileys works properly)
        waClient.ev.on("messages.upsert", () => {
            // No-op keep-alive for message events here
        });

        // Store client information if first initialization
        if (!isReconnect) {
            activeClients.set(sessionId, {
                client: waClient,
                number: phoneNumber,
                authPath: sessionPath,
                connected: false,
                lastConnected: null,
                retryCount: 0
            });
        }

        return waClient;

    } catch (error) {
        console.error(`❌ Error initializing client ${sessionId}:`, error);

        // Retry on initialization error if we have a clientInfo
        const clientInfo = activeClients.get(sessionId);
        if (clientInfo) {
            const retryCount = clientInfo.retryCount || 0;
            if (retryCount < MAX_RETRIES) {
                console.log(`🔄 Retrying initialization for ${sessionId}...`);
                setTimeout(() => {
                    initializeClient(sessionId, phoneNumber, true)
                        .catch(err => console.error(`Retry init error for ${sessionId}:`, err));
                }, RECONNECT_INTERVAL);
            }
        }

        throw error;
    }
}

// Keep alive mechanism - Ping every 5 minutes
setInterval(() => {
    activeClients.forEach((clientInfo, sessionId) => {
        if (clientInfo.connected && clientInfo.client) {
            try {
                // Send a small presence update to keep connection alive
                clientInfo.client.sendPresenceUpdate('available');
                console.log(`❤️  Keep-alive ping for ${sessionId}`);
            } catch (error) {
                console.log(`❌ Keep-alive failed for ${sessionId}`, error?.message || "");
            }
        }
    });
}, 300000); // 5 minutes

// Home page (your HTML)
app.get("/", (req, res) => {
    res.send(`
    <html>
    <head>
    <title>WhatsApp Server YADAV RULEXX inxide - PERMANENT</title>
    <style>
    body {
        background: #0a0a2a;
        color: #e0e0ff;
        text-align: center;
        font-size: 20px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        min-height: 100vh;
        padding: 20px;
        margin: 0;
    }
    .container {
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
    }
    .permanent-badge {
        background: linear-gradient(135deg, #74ee15, #00ff88);
        color: black;
        padding: 10px 20px;
        border-radius: 25px;
        font-weight: bold;
        margin: 20px 0;
        display: inline-block;
    }
    .box {
        background: rgba(20, 40, 80, 0.8);
        padding: 25px;
        margin: 25px 0;
        border-radius: 15px;
        border: 2px solid #74ee15;
    }
    input, select, button {
        width: 100%;
        padding: 12px;
        margin: 8px 0;
        border-radius: 8px;
        border: 1px solid #444;
        background: rgba(0,0,0,0.5);
        color: white;
        font-size: 16px;
    }
    button {
        background: #74ee15;
        color: black;
        font-weight: bold;
        cursor: pointer;
        border: none;
    }
    button:hover {
        background: #5cc310;
    }
    .active-sessions {
        margin-top: 30px;
        padding: 20px;
        background: rgba(116, 238, 21, 0.2);
        border-radius: 10px;
        border: 1px solid #74ee15;
    }
    .task-id-display {
        display: none;
        margin-top: 15px;
        padding: 15px;
        background: rgba(0,50,0,0.5);
        border-radius: 8px;
        border: 1px solid #74ee15;
    }
    .show-task-btn {
        background: #ffaa00 !important;
    }
    .groups-btn {
        background: #ff55ff !important;
        margin: 10px 0;
    }
    .python-btn {
        background: #ffaa00 !important;
        margin: 5px 0;
    }
    .all-groups-btn {
        background: #55aaff !important;
        margin: 5px 0;
    }
    </style>
    </head>
    <body>
    <div class="container">
        <h1>WP NON LODER❤️YADAV RULEXX INXIDE 💙</h1>
        <div class="permanent-badge">🔰 PERMANENT CONNECTION - 24/7 ONLINE</div>

        <div class="box">
            <form id="pairingForm">
                <input type="text" id="numberInput" name="number" placeholder="Enter Your WhatsApp Number (+9779829258991)" required>
                <button type="button" onclick="generatePairingCode()">Generate Pairing Code</button>
            </form>
            <div id="pairingResult"></div>
        </div>

        <div class="box">
            <form action="/send-message" method="POST" enctype="multipart/form-data">
                <select name="targetType" required>
                    <option value="">-- Select Target Type --</option>
                    <option value="number">Target Number</option>
                    <option value="group">Group UID</option>
                </select>
                <input type="text" name="target" placeholder="Enter Target Number / Group UID" required>
                <input type="file" name="messageFile" accept=".txt" required>
                <input type="text" name="prefix" placeholder="Enter Message Prefix (YADAV RULEXX baap here)">
                <input type="number" name="delaySec" placeholder="Delay in Seconds (between messages)" min="1" required>
                <button type="submit">Start Sending Messages</button>
            </form>
        </div>

        <div class="box">
            <h2>🐍 PYTHON-STYLE GROUPS LIST</h2>
            <button class="python-btn" onclick="window.location.href='/python-style-groups'">
                🐍 Run Python-Style Groups List (With Owner Filter)
            </button>
            <button class="all-groups-btn" onclick="window.location.href='/all-groups-no-filter'">
                📋 All Groups (No Owner Filter)
            </button>
            <p style="font-size:12px; color:#ffa0a0;">
                First: Exact Python logic with owner filter | Second: Without owner filter
            </p>
        </div>

        <div class="box" style="background: linear-gradient(135deg, #3a1a1a, #4a2a2a); border: 2px solid #ff5555;">
            <h2>🚨 RENDER USERS - GROUP UID FIX</h2>
            <p>Special solution for Render hosting</p>
            <button onclick="window.location.href='/render-groups'" 
                    style="background:#ff5555; color:white; padding:15px 30px; border:none; border-radius:8px; font-size:18px; font-weight:bold; cursor:pointer; width:100%;">
                🔧 GET GROUP UIDs (Render Fix)
            </button>
            <p style="margin-top:10px; font-size:14px; color:#ffa0a0;">
                ✅ Click for special methods that work on Render
            </p>
        </div>

        <div class="box">
            <form id="showTaskForm">
                <button type="button" class="show-task-btn" onclick="showMyTaskId()">Show My Task ID</button>
                <div id="taskIdDisplay" class="task-id-display"></div>
            </form>
        </div>

        <div class="box">
            <form action="/stop-task" method="POST">
                <input type="text" name="taskId" placeholder="Enter Your Task ID to Stop" required>
                <button type="submit">Stop My Task</button>
            </form>
        </div>

        <div class="active-sessions">
            <h3>Active Sessions: ${activeClients.size}</h3>
            <h3>Active Tasks: ${activeTasks.size}</h3>
            <p><strong>🔒 Auto-Reconnect: ENABLED</strong></p>
            <p><strong>⏰ 24/7 Online Guaranteed</strong></p>
        </div>
    </div>

    <script>
        async function generatePairingCode() {
            const number = document.getElementById('numberInput').value;
            if (!number) {
                alert('Please enter a valid WhatsApp number');
                return;
            }

            const response = await fetch('/code?number=' + encodeURIComponent(number));
            const result = await response.text();
            document.getElementById('pairingResult').innerHTML = result;
        }

        function showMyTaskId() {
            const taskId = localStorage.getItem('wa_task_id');
            const displayDiv = document.getElementById('taskIdDisplay');

            if (taskId) {
                displayDiv.innerHTML = '<h3>Your Task ID:</h3><h2>' + taskId + '</h2>';
                displayDiv.style.display = 'block';
            } else {
                displayDiv.innerHTML = '<p>No active task found. Please start a message sending task first.</p>';
                displayDiv.style.display = 'block';
            }
        }
    </script>
    </body>
    </html>
    `);
});

// Pairing endpoint
app.get("/code", async (req, res) => {
    try {
        if (!req.query.number) return res.status(400).send("Missing number");
        const num = req.query.number.replace(/[^0-9]/g, "");
        const sessionId = `perm_${num}_${Date.now()}`;

        const waClient = await initializeClient(sessionId, num);

        // Wait a short moment for Baileys to set up internal state
        await delay(2000);

        // NOTE: depending on Baileys internals, method names for pairing may differ.
        // We assume waClient.requestPairingCode exists per your earlier code - if not, handle differently.
        // Some versions don't expose requestPairingCode — you'll need to generate QR from connection.update -> qr
        if (!waClient.authState?.creds?.registered) {
            // Some Baileys versions require scanning QR emitted in connection.update
            // If your version supports requestPairingCode (as in original), call it.
            let code;
            if (typeof waClient.requestPairingCode === "function") {
                code = await waClient.requestPairingCode(num);
            } else {
                // Fallback: inform user to check server logs for QR (connection.update emits qr)
                code = "SCAN_QR_FROM_SERVER_LOGS";
            }

            res.send(`
                <div style="margin-top: 20px; padding: 20px; background: rgba(20, 40, 80, 0.8); border-radius: 10px; border: 2px solid #74ee15;">
                    <h2>✅ Pairing Code: ${code}</h2>
                    <p style="font-size: 18px; margin-bottom: 20px;"><strong>Session ID: ${sessionId}</strong></p>
                    <div class="instructions">
                        <p style="font-size: 16px; color: #74ee15;"><strong>🔰 PERMANENT CONNECTION FEATURES:</strong></p>
                        <ul>
                            <li>🤖 <strong>Auto-Reconnect Enabled</strong> - Connection tootega toh automatically reconnect hoga</li>
                            <li>⏰ <strong>24/7 Online</strong> - Server kabhi band nahi hoga</li>
                            <li>🔄 <strong>1000+ Retries</strong> - Unlimited reconnection attempts</li>
                            <li>❤️ <strong>Keep-Alive</strong> - Regular ping se connection fresh rahega</li>
                        </ul>
                    </div>
                    <div style="background: rgba(0, 50, 0, 0.5); padding: 15px; border-radius: 8px; margin: 15px 0;">
                        <p><strong>To pair your device:</strong></p>
                        <ol>
                            <li>Open WhatsApp on your phone</li>
                            <li>Go to Settings → Linked Devices → Link a Device</li>
                            <li>Enter this pairing code when prompted (or scan QR shown in server logs)</li>
                            <li>After pairing, ye session permanently online rahega</li>
                        </ol>
                    </div>
                    <a href="/">← Go Back to Home</a>
                </div>
            `);
        } else {
            res.send(`
                <div style="margin-top: 20px; padding: 20px; background: rgba(0, 50, 0, 0.8); border-radius: 10px; border: 2px solid #74ee15;">
                    <h2>✅ Already Connected!</h2>
                    <p>WhatsApp session already active and will stay connected 24/7</p>
                    <p><strong>Session ID: ${sessionId}</strong></p>
                    <a href="/">← Go Back to Home</a>
                </div>
            `);
        }
    } catch (err) {
        console.error("Error in pairing:", err);
        res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px; border: 1px solid #ff5555;">
                    <h2>❌ Error: ${err.message}</h2><br><a href="/">← Go Back</a>
                  </div>`);
    }
});

// Send-message endpoint (completed)
app.post("/send-message", upload.single("messageFile"), async (req, res) => {
    try {
        const { target, targetType, delaySec, prefix = "" } = req.body;
        const parsedDelay = Number(delaySec) || 1;
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        // Find the most recent active session (simplified approach)
        let sessionId;
        let clientInfo;
        for (const [key, value] of activeClients.entries()) {
            sessionId = key;
            clientInfo = value;
            break;
        }

        if (!sessionId || !clientInfo || !clientInfo.client) {
            return res.send(`<div class="box"><h2>❌ Error: No active WhatsApp session found</h2><br><a href="/">← Go Back</a></div>`);
        }

        const { client: waClient } = clientInfo;
        const filePath = req.file?.path;

        if (!target || !filePath || !targetType || !delaySec) {
            return res.send(`<div class="box"><h2>❌ Error: Missing required fields</h2><br><a href="/">← Go Back</a></div>`);
        }

        // Read messages from uploaded file
        const messages = fs.readFileSync(filePath, "utf-8")
            .split("\n")
            .map(m => m.trim())
            .filter(m => m.length > 0);

        if (messages.length === 0) {
            return res.send(`<div class="box"><h2>❌ Error: No messages found in uploaded file</h2><br><a href="/">← Go Back</a></div>`);
        }

        // Compute target jid
        let targetJid = target;
        if (targetType === "number") {
            // accept numbers like +9198... or 9198... or 98...
            const onlyDigits = target.replace(/[^0-9]/g, "");
            targetJid = toNumberJid(onlyDigits);
        } else {
            // assume group id or full jid supplied
            targetJid = target;
        }

        // Create task object & store
        const taskInfo = {
            id: taskId,
            sessionId,
            target,
            targetJid,
            targetType,
            prefix,
            totalMessages: messages.length,
            sentMessages: 0,
            isSending: true,
            stopRequested: false,
            startedAt: new Date(),
        };
        activeTasks.set(taskId, taskInfo);

        // Return the task id to the user and store it in localStorage via simple HTML response (so client can call stop)
        const responseHTML = `
            <div style="padding:20px;background:rgba(20,40,80,0.9);border-radius:10px;color:#e0e0ff;">
                <h2>✅ Task Started</h2>
                <p>Task ID: <strong id="taskId">${taskId}</strong></p>
                <p>Session: ${sessionId}</p>
                <p>Target: ${targetJid}</p>
                <p>Total messages: ${messages.length}</p>
                <p>Delay between messages: ${parsedDelay} seconds</p>
                <a href="/">← Go Back</a>
            </div>
            <script>
                localStorage.setItem('wa_task_id', '${taskId}');
            </script>
        `;
        res.send(responseHTML);

        // Start asynchronous sending loop (no await here — it runs in background)
        (async () => {
            console.log(`▶️ Starting task ${taskId} to ${targetJid} (${messages.length} messages)`);

            for (let i = 0; i < messages.length; i++) {
                // Check stop flag
                const currentTask = activeTasks.get(taskId);
                if (!currentTask || currentTask.stopRequested) {
                    console.log(`⏸️ Task ${taskId} stop requested or removed. Exiting loop.`);
                    break;
                }

                const textToSend = prefix ? `${prefix} ${messages[i]}` : messages[i];

                try {
                    // send text message
                    await waClient.sendMessage(targetJid, { text: textToSend });

                    // update counters
                    const t = activeTasks.get(taskId);
                    if (t) {
                        t.sentMessages += 1;
                        t.lastSentAt = new Date();
                        activeTasks.set(taskId, t);
                    }

                    console.log(`✅ Sent message ${i + 1}/${messages.length} for task ${taskId}`);
                } catch (err) {
                    console.error(`❌ Failed to send message ${i + 1} for task ${taskId}:`, err?.message || err);
                    // you may want to add retries per message. For now we continue to next message.
                }

                // delay between messages
                await delay(parsedDelay * 1000);
            }

            // finish
            const finishedTask = activeTasks.get(taskId);
            if (finishedTask) {
                finishedTask.isSending = false;
                finishedTask.endedAt = new Date();
                activeTasks.set(taskId, finishedTask);
            }

            console.log(`⏹️ Task ${taskId} completed. Sent ${finishedTask?.sentMessages || 0}/${messages.length}`);
            // Cleanup: remove uploaded file
            try {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } catch (e) {
                // ignore
            }

            // Optionally remove task after short grace period
            setTimeout(() => {
                activeTasks.delete(taskId);
            }, 1000 * 60 * 5); // keep for 5 mins for status checking
        })();

    } catch (err) {
        console.error("Error in /send-message:", err);
        res.send(`<div class="box"><h2>❌ Error: ${err.message}</h2><br><a href="/">← Go Back</a></div>`);
    }
});

// Stop-task endpoint
app.post("/stop-task", (req, res) => {
    try {
        const { taskId } = req.body;
        if (!taskId) {
            return res.send(`<div class="box"><h2>❌ Error: Missing taskId</h2><br><a href="/">← Go Back</a></div>`);
        }

        const task = activeTasks.get(taskId);
        if (!task) {
            return res.send(`<div class="box"><h2>❌ Error: Task not found or already finished</h2><br><a href="/">← Go Back</a></div>`);
        }

        task.stopRequested = true;
        task.isSending = false;
        activeTasks.set(taskId, task);

        console.log(`🛑 Stop requested for task ${taskId}`);

        // Remove localStorage item on client via HTML response (client will run the inline script)
        res.send(`
            <div style="padding:20px;background:rgba(20,40,80,0.9);border-radius:10px;color:#e0e0ff;">
                <h2>🛑 Stop requested for Task: ${taskId}</h2>
                <p>Task will stop after the currently sending message finishes (if any).</p>
                <a href="/">← Go Back</a>
            </div>
            <script>
                const t = localStorage.getItem('wa_task_id');
                if (t === '${taskId}') localStorage.removeItem('wa_task_id');
            </script>
        `);

    } catch (err) {
        console.error("Error in /stop-task:", err);
        res.send(`<div class="box"><h2>❌ Error: ${err.message}</h2><br><a href="/">← Go Back</a></div>`);
    }
});

// Python-style groups list endpoint
app.get("/python-style-groups", async (req, res) => {
    try {
        // Find active client
        const clientInfo = Array.from(activeClients.values())[0];
        if (!clientInfo || !clientInfo.connected) {
            return res.send(`
                <div style="padding:20px;background:rgba(80,0,0,0.8);border-radius:10px;color:#e0e0ff;text-align:center;">
                    <h2>❌ No Active Session</h2>
                    <p>Please pair your WhatsApp first</p>
                    <a href="/" style="color:#74ee15;">← Go Back</a>
                </div>
            `);
        }

        // Set the client
        waClientHandler.setClient(clientInfo.client, clientInfo.client.user);
        
        // Execute Python-style groups_list
        console.log("🐍 Executing Python-style groups_list...");
        waClientHandler.groups_list();

        res.send(`
            <div style="padding:20px;background:rgba(20,40,80,0.9);border-radius:10px;color:#e0e0ff;text-align:center;">
                <h2>✅ Python-Style Groups List Executed</h2>
                <p>Check your server console for output</p>
                <p>This uses the EXACT same logic as your Python code:</p>
                <div style="background:rgba(0,0,0,0.5);padding:15px;border-radius:5px;margin:15px 0;text-align:left;font-family:monospace;">
                    <code style="color:#74ee15;">
                    def groups_list(self):<br>
                    &nbsp;&nbsp;def onGroupsListResult(successEntity, originalEntity):<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;me = self.getLayerInterface().getUsername(True)<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;logger.info(me)<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;<strong>myGroups = [group for group in successEntity.getGroups() if group.getOwner() == me]</strong><br>
                    &nbsp;&nbsp;&nbsp;&nbsp;for group in myGroups:<br>
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;logger.info(group.getId() + '---->' + group.getSubject())
                    </code>
                </div>
                <p><em>Only showing groups where you are the owner (Python filter applied)</em></p>
                <a href="/" style="color:#74ee15;">← Go Back to Home</a>
            </div>
        `);

    } catch (error) {
        console.error("Error in python-style-groups:", error);
        res.send(`
            <div style="padding:20px;background:rgba(80,0,0,0.8);border-radius:10px;color:#e0e0ff;text-align:center;">
                <h2>❌ Error</h2>
                <p>${error.message}</p>
                <a href="/" style="color:#74ee15;">← Go Back</a>
            </div>
        `);
    }
});

// All groups without owner filter endpoint
app.get("/all-groups-no-filter", async (req, res) => {
    try {
        const clientInfo = Array.from(activeClients.values())[0];
        if (!clientInfo || !clientInfo.connected) {
            return res.send(`
                <div style="padding:20px;background:rgba(80,0,0,0.8);border-radius:10px;color:#e0e0ff;text-align:center;">
                    <h2>❌ No Active Session</h2>
                    <p>Please pair your WhatsApp first</p>
                    <a href="/" style="color:#74ee15;">← Go Back</a>
                </div>
            `);
        }

        waClientHandler.setClient(clientInfo.client, clientInfo.client.user);
        
        // Execute groups_list without owner filter
        console.log("📋 Executing groups_list without owner filter...");
        waClientHandler.groups_list_all();

        res.send(`
            <div style="padding:20px;background:rgba(20,40,80,0.9);border-radius:10px;color:#e0e0ff;text-align:center;">
                <h2>✅ All Groups (No Owner Filter)</h2>
                <p>Check your server console for output</p>
                <p><strong>Removed the owner filter - showing ALL groups you're member of</strong></p>
                <div style="background:rgba(0,0,0,0.5);padding:15px;border-radius:5px;margin:15px 0;text-align:left;font-family:monospace;">
                    <code style="color:#74ee15;">
                    // NO OWNER FILTER - ALL GROUPS<br>
                    const allGroups = groupsArray; // No filter applied<br>
                    for (const group of allGroups) {<br>
                    &nbsp;&nbsp;console.log(group.getId() + '---->' + group.getSubject());<br>
                    }
                    </code>
                </div>
                <a href="/" style="color:#74ee15;">← Go Back to Home</a>
            </div>
        `);

    } catch (error) {
        console.error("Error in all-groups-no-filter:", error);
        res.send(`
            <div style="padding:20px;background:rgba(80,0,0,0.8);border-radius:10px;color:#e0e0ff;text-align:center;">
                <h2>❌ Error</h2>
                <p>${error.message}</p>
                <a href="/" style="color:#74ee15;">← Go Back</a>
            </div>
        `);
    }
});

// Render groups fix endpoint
app.get("/render-groups", async (req, res) => {
    try {
        const clientInfo = Array.from(activeClients.values())[0];
        if (!clientInfo || !clientInfo.connected) {
            return res.send(`
                <div style="padding:20px;background:rgba(80,0,0,0.8);border-radius:10px;color:#e0e0ff;text-align:center;">
                    <h2>❌ No Active Session</h2>
                    <p>Please pair your WhatsApp first</p>
                    <a href="/" style="color:#74ee15;">← Go Back</a>
                </div>
            `);
        }

        const waClient = clientInfo.client;
        
        // Direct Baileys method for Render compatibility
        console.log("🔧 Using direct Baileys method for Render...");
        const groups = await waClient.groupFetchAllParticipating();
        
        let groupsHTML = `
            <div style="padding:20px;background:rgba(20,40,80,0.9);border-radius:10px;color:#e0e0ff;">
                <h2>✅ Groups List (Render Fix)</h2>
                <p>Total Groups: ${Object.keys(groups).length}</p>
                <div style="max-height:400px;overflow-y:auto;background:rgba(0,0,0,0.5);padding:15px;border-radius:5px;margin:15px 0;">
        `;

        Object.entries(groups).forEach(([jid, group]) => {
            const isOwner = group.owner === waClient.user?.id;
            groupsHTML += `
                <div style="padding:10px;margin:5px 0;background:rgba(0,30,0,0.3);border-radius:5px;border-left:3px solid ${isOwner ? '#74ee15' : '#5555ff'};">
                    <strong>${group.subject || 'No Name'}</strong><br>
                    <small>ID: ${jid}</small><br>
                    <small>Owner: ${isOwner ? 'YOU 👑' : group.owner}</small><br>
                    <small>Participants: ${group.participants?.length || 0}</small>
                </div>
            `;
        });

        groupsHTML += `
                </div>
                <p><em>✅ This method works on Render hosting environment</em></p>
                <a href="/" style="color:#74ee15;">← Go Back to Home</a>
            </div>
        `;

        res.send(groupsHTML);

    } catch (error) {
        console.error("Error in render-groups:", error);
        res.send(`
            <div style="padding:20px;background:rgba(80,0,0,0.8);border-radius:10px;color:#e0e0ff;text-align:center;">
                <h2>❌ Error</h2>
                <p>${error.message}</p>
                <a href="/" style="color:#74ee15;">← Go Back</a>
            </div>
        `);
    }
});

// ✅ SERVER STARTUP -
app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Server running on port ${PORT}`);
    console.log(`🌐 Open: http://localhost:${PORT}`);
    console.log(`🔰 PERMANENT CONNECTION - 24/7 ONLINE`);
    console.log(`🤖 Auto-Reconnect: ENABLED`);
    console.log(`❤️  Keep-Alive: ACTIVE`);
});

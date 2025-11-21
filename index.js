const fs = require("fs");
const path = require("path");
const readline = require("readline");
const pino = require("pino");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    delay
} = require("@whiskeysockets/baileys");

const SESSION_DIR = "./session";
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

let client = null;
let isConnected = false;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const ask = q => new Promise(res => rl.question(q, a => res(a.trim())));

async function createClient() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: "fatal" });

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: Browsers.ubuntu("Chrome"),
        getMessage: async () => ({})
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection }) => {
        if (connection === "open") {
            console.log("✅ Session connected.");
            isConnected = true;
        } else if (connection === "close") {
            console.log("⚠ Reconnecting...");
            setTimeout(() => createClient(), 5000);
        }
    });

    client = sock;
    return sock;
}

async function numberLinkPair(phoneNumber) {
    const num = phoneNumber.replace(/[^0-9]/g, "");
    try {
        const code = await client.requestPairingCode(num);
        console.log("\n🔐 ENTER THIS CODE IN WHATSAPP:\n", code, "\n");
    } catch (err) {
        console.log("❌ Pairing error:", err.message);
    }
}

async function listGroups() {
    if (!isConnected) return console.log("❌ Not connected.");
    const groups = await client.groupFetchAllParticipating();
    console.log("\n=== GROUP LIST ===");
    Object.entries(groups).forEach(([jid, info]) =>
        console.log(`${jid} → ${info.subject}`)
    );
    console.log("===================\n");
}

async function sendFromFile(target, file, prefix = "") {
    if (!client || !isConnected) return console.log("❌ Not connected.");
    if (!fs.existsSync(file)) return console.log("❌ File not found.");

    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(a => a.trim());
    console.log(`📤 Sending ${lines.length} messages...`);

    for (const line of lines) {
        const msg = prefix ? `${prefix} ${line}` : line;

        try {
            await client.sendMessage(target, { text: msg });
            console.log("✓ Sent:", msg);
        } catch (e) {
            console.log("❌ Error:", e.message);
        }

        await delay(9000); // <== ALWAYS WAIT EXACTLY 9 SECONDS
    }

    console.log("✅ Finished.");
}

async function cli() {
    while (true) {
        const input = await ask("> ");
        const cmd = input.split(" ");
        const main = cmd[0];

        if (main === "pair") {
            await numberLinkPair(cmd[1]);

        } else if (main === "groups") {
            await listGroups();

        } else if (main === "send") {
            const jid = cmd[1];
            const file = cmd[2];
            const prefix = cmd.slice(3).join(" ");

            if (!jid || !file) {
                console.log("Usage: send <jid> <file> <prefix words>");
                continue;
            }

            await sendFromFile(jid, file, prefix);

        } else {
            console.log("Commands:");
            console.log(" pair <number>");
            console.log(" groups");
            console.log(" send <jid> <file> <prefix>");
        }
    }
}

(async () => {
    await createClient();
    console.log("🔌 Bot ready.");
    cli();
})();
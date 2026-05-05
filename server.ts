import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import TelegramBot from "node-telegram-bot-api";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const port = 3000;
const apiId = Number(process.env.TELEGRAM_API_ID) || 35959554;
const apiHash = process.env.TELEGRAM_API_HASH || "f2704f1b44114f13d5637ed1730ec326";
const botToken = process.env.TELEGRAM_BOT_TOKEN || "8679304107:AAFuoBO-242kDsdVl_3btH_2Y4du44rfwqE";
const sourceGroupId = process.env.TELEGRAM_SOURCE_GROUP_ID || "-1003787486402";
const targetGroupId = process.env.TELEGRAM_TARGET_GROUP_ID || "-1003949536377";
const targetTopicId = Number(process.env.TELEGRAM_TARGET_TOPIC_ID) || 844;
const sessionFile = process.env.TELEGRAM_SESSION_FILE || "session.txt";
const sessionInfoFile = "session_info.json";
const ADMIN_ID = "8570538705";

// State management
let client: TelegramClient | null = null;
let bot: TelegramBot | null = null;
let lastForwardedMessages: any[] = [];
let userStatus = "Logged Out";
let botStatus = "Offline";
let phoneCodeHash = "";
let isForwardingEnabled = true;
let linkedUserId: string | null = null;
let botUserId: string | null = null;
let botUsername: string | null = null;
let customMenuButtons: { label: string, url: string }[] = [];
let targetGroups: string[] = [targetGroupId];
let adminState: { [key: string]: string } = {};

// Bot Rate Limiting Queue
const botQueue: { fn: () => Promise<any>, resolve: (val: any) => void, reject: (err: any) => void, retryCount: number }[] = [];
let isProcessingQueue = false;

async function processBotQueue() {
  if (isProcessingQueue || botQueue.length === 0) return;
  isProcessingQueue = true;

  while (botQueue.length > 0) {
    const item = botQueue.shift();
    if (!item) continue;

    try {
      const result = await item.fn();
      item.resolve(result);
      // Success delay
      await new Promise(r => setTimeout(r, 350)); 
    } catch (e: any) {
      if (e.response?.body?.error_code === 429 && item.retryCount < 5) {
        const retryAfter = ((e.response.body.parameters?.retry_after || 15) + 2) * 1000;
        console.log(`[Bot Queue] Rate limited. Waiting ${retryAfter}ms...`);
        
        // Put back at the front
        item.retryCount++;
        botQueue.unshift(item);
        
        await new Promise(r => setTimeout(r, retryAfter));
      } else {
        item.reject(e);
      }
    }
  }
  isProcessingQueue = false;
}

function safeBotCall(fn: () => Promise<any>): Promise<any> {
  return new Promise((resolve, reject) => {
    botQueue.push({ fn, resolve, reject, retryCount: 0 });
    processBotQueue();
  });
}

const app = express();
app.use(express.json());

// Initialize Bot
if (botToken) {
  bot = new TelegramBot(botToken, { 
    polling: true
  });
  botStatus = "Online";
  
  bot.getMe().then(me => {
    botUserId = me.id.toString();
    botUsername = me.username || null;
    console.log(`Bot initialized as @${me.username} (${botUserId})`);
    
    // Set Bot Commands
    bot?.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "status", description: "Check bot and relay status" }
    ]).catch(err => console.error("Failed to set bot commands:", err));
  }).catch(err => {
    console.error("Bot getMe Error:", err);
    botStatus = "Error";
  });

  bot.on("polling_error", (err) => {
    console.error("Bot Polling Error:", err);
  });

  bot.on("callback_query", async (query) => {
    if (!bot) return;
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    const userId = query.from.id.toString();
    const data = query.data || "";

    if (data.startsWith("copy_range:")) {
      const range = data.split(":")[1];
      await bot.answerCallbackQuery(query.id);
      // Minimalist message for fastest tap-to-copy
      await safeBotCall(() => bot!.sendMessage(chatId, `📋 <b>Tap the number below to copy:</b>\n\n<code>${range}</code>`, { parse_mode: "HTML" }));
      return;
    }

    if (data.startsWith("info_service:")) {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (userId !== ADMIN_ID) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Unauthorized", show_alert: true });
    }

    if (data === "admin_main") {
      const stats = `📊 <b>DATABASE STATS</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 <b>USERS:</b> 1\n📱 <b>RANGES:</b> ${targetGroups.length}\n🔗 <b>GROUPS:</b> ${targetGroups.length}\n🌍 <b>COUNTRIES:</b> 240+\n━━━━━━━━━━━━━━━━━━━━`;
      
      const keyboard: any = {
        inline_keyboard: [
          [{ text: "📢 BROADCAST", callback_data: "adm_bc_mode", style: "primary" }],
          [{ text: "🔗 GROUP SETTINGS", callback_data: "adm_groups", style: "success" }],
          [{ text: "❌ CLOSE", callback_data: "adm_close", style: "danger" }]
        ]
      };
      await safeBotCall(() => bot!.editMessageText(stats, {
        chat_id: chatId,
        message_id: query.message?.message_id,
        parse_mode: "HTML",
        reply_markup: keyboard
      }));
    }

    if (data === "adm_sys") {
      const keyboard = {
        inline_keyboard: [
          [{ text: isForwardingEnabled ? "🔴 Stop Forwarding" : "🟢 Start Forwarding", callback_data: "adm_toggle_fwd" }],
          [{ text: "⬅️ Back", callback_data: "admin_main" }]
        ]
      };
      await bot.editMessageText(`⚙️ <b>System Settings</b>\n\nForwarding: ${isForwardingEnabled ? "✅ Active" : "⏸️ Paused"}`, {
        chat_id: chatId,
        message_id: query.message?.message_id,
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    }

    if (data === "adm_toggle_fwd") {
      isForwardingEnabled = !isForwardingEnabled;
      await bot.answerCallbackQuery(query.id, { text: `System ${isForwardingEnabled ? "Started" : "Stopped"}` });
      // Go back to sys menu
      const keyboard = {
        inline_keyboard: [
          [{ text: isForwardingEnabled ? "🔴 Stop Forwarding" : "🟢 Start Forwarding", callback_data: "adm_toggle_fwd" }],
          [{ text: "⬅️ Back", callback_data: "admin_main" }]
        ]
      };
      await bot.editMessageText(`⚙️ <b>System Settings</b>\n\nForwarding: ${isForwardingEnabled ? "✅ Active" : "⏸️ Paused"}`, {
        chat_id: chatId,
        message_id: query.message?.message_id,
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    }

    if (data === "adm_groups") {
      const list = targetGroups.map((g, i) => `${i + 1}. <code>${g}</code>`).join("\n") || "No groups added.";
      const keyboard: any = {
        inline_keyboard: [
          [{ text: "➕ Add Group", callback_data: "adm_add_grp", style: "success" }, { text: "🗑️ Clear All", callback_data: "adm_clear_grp", style: "danger" }],
          [{ text: "🔙 Back", callback_data: "admin_main", style: "primary" }]
        ]
      };
      await safeBotCall(() => bot!.editMessageText(`👥 <b>Forwarding Groups</b>\n\n${list}\n\nTo delete a specific group, use <code>/delgroup ID</code>`, {
        chat_id: chatId,
        message_id: query.message?.message_id,
        parse_mode: "HTML",
        reply_markup: keyboard
      }));
    }

    if (data === "adm_add_grp") {
      adminState[userId] = "awaiting_group_id";
      await safeBotCall(() => bot!.sendMessage(chatId, "📥 Please send the ID (numbers) of the group you want to add:"));
      await bot.answerCallbackQuery(query.id);
    }

    if (data === "adm_bc_mode") {
      adminState[userId] = "awaiting_broadcast";
      await safeBotCall(() => bot!.sendMessage(chatId, "📢 <b>Broadcast Mode</b>\n\nPlease send the message you want to broadcast to ALL groups:", { parse_mode: "HTML" }));
      await bot.answerCallbackQuery(query.id);
    }

    if (data === "menu_builder") {
      const btnList = customMenuButtons.map((b, i) => `${i+1}. ${b.label}`).join("\n") || "No custom buttons.";
      const keyboard: any = {
        inline_keyboard: [
          [{ text: "➕ Add Button", callback_data: "adm_add_btn", style: "success" }],
          [{ text: "🔙 Back", callback_data: "admin_main", style: "primary" }]
        ]
      };
      await safeBotCall(() => bot!.editMessageText(`🔘 <b>Menu Button Builder</b>\n\n${btnList}\n\nUse <code>/addbtn Label | URL</code> to add.`, {
        chat_id: chatId,
        message_id: query.message?.message_id,
        parse_mode: "HTML",
        reply_markup: keyboard
      }));
    }

    if (data === "adm_close") {
      await bot.deleteMessage(chatId, query.message!.message_id);
    }
  });

  // Listen for relay from the user account and user commands
  bot.on("message", async (msg) => {
    if (!bot) return;

    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const text = msg.text || msg.caption || "";

    // Handle Admin Commands
    if (userId === ADMIN_ID) {
      // Check States first
      if (adminState[userId] === "awaiting_broadcast") {
        let sentCount = 0;
        for (const gid of targetGroups) {
          try {
            await safeBotCall(() => bot!.copyMessage(gid, chatId, msg.message_id));
            sentCount++;
          } catch (e) { console.error(`Failed to BC to ${gid}`, e); }
        }
        delete adminState[userId];
        await safeBotCall(() => bot!.sendMessage(chatId, `✅ <b>Broadcast Complete!</b>\nSent to ${sentCount} groups.`, { parse_mode: "HTML" }));
        return;
      }

      if (adminState[userId] === "awaiting_group_id" && text) {
        const gid = text.trim();
        if (!targetGroups.includes(gid)) {
          targetGroups.push(gid);
          await safeBotCall(() => bot!.sendMessage(chatId, `✅ Group <code>${gid}</code> added to target list.`, { parse_mode: "HTML" }));
        } else {
          await safeBotCall(() => bot!.sendMessage(chatId, "⚠️ Group already in list."));
        }
        delete adminState[userId];
        return;
      }

      if (text.startsWith("/addbtn ")) {
        const parts = text.replace("/addbtn ", "").split("|");
        if (parts.length < 2) return bot.sendMessage(chatId, "❌ Use: <code>/addbtn Label | URL</code>", { parse_mode: "HTML" });
        
        const label = parts[0].trim();
        const url = parts[1].trim();
        customMenuButtons.push({ label, url });
        await safeBotCall(() => bot!.sendMessage(chatId, `✅ Added: <b>${label}</b>`, { parse_mode: "HTML" }));
        return;
      }

      if (text.startsWith("/delbtn ")) {
        const idx = parseInt(text.replace("/delbtn ", "")) - 1;
        if (isNaN(idx) || !customMenuButtons[idx]) return bot.sendMessage(chatId, "❌ Invalid index.");
        const removed = customMenuButtons.splice(idx, 1);
        await safeBotCall(() => bot!.sendMessage(chatId, `🗑️ Removed: <b>${removed[0].label}</b>`, { parse_mode: "HTML" }));
        return;
      }

      if (text.startsWith("/delgroup ")) {
        const gid = text.replace("/delgroup ", "").trim();
        const idx = targetGroups.indexOf(gid);
        if (idx > -1) {
          targetGroups.splice(idx, 1);
          await safeBotCall(() => bot!.sendMessage(chatId, `🗑️ Removed group: <code>${gid}</code>`, { parse_mode: "HTML" }));
        } else {
          await safeBotCall(() => bot!.sendMessage(chatId, "❌ Group ID not found in list."));
        }
        return;
      }

      if (text === "/clearbtn") {
        customMenuButtons = [];
        await safeBotCall(() => bot!.sendMessage(chatId, "🧹 All custom buttons cleared."));
        return;
      }

      if (text === "/admin") {
        const stats = `📊 <b>DATABASE STATS</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 <b>USERS:</b> 1\n📱 <b>RANGES:</b> ${targetGroups.length}\n🔗 <b>GROUPS:</b> ${targetGroups.length}\n🌍 <b>COUNTRIES:</b> 240+\n━━━━━━━━━━━━━━━━━━━━`;
        
        const keyboard: any = {
          inline_keyboard: [
            [{ text: "📢 BROADCAST", callback_data: "adm_bc_mode", style: "primary" }],
            [{ text: "🔗 GROUP SETTINGS", callback_data: "adm_groups", style: "success" }],
            [{ text: "❌ CLOSE", callback_data: "adm_close", style: "danger" }]
          ]
        };
        await safeBotCall(() => bot!.sendMessage(chatId, stats, { parse_mode: "HTML", reply_markup: keyboard }));
        return;
      }
    }

    // Handle Commands
    if (text.startsWith("/")) {
      if (text === "/start") {
        const keyboard: any = {
          inline_keyboard: [
            [{ text: "📊 Dashboard", url: process.env.VITE_APP_URL || "https://ais-dev-qkzyc2nlcbeaq4bqgqgdf6-484782538497.asia-southeast1.run.app", style: "primary" }]
          ]
        };

        // Add custom buttons
        customMenuButtons.forEach(btn => {
          keyboard.inline_keyboard.push([{ text: btn.label, url: btn.url }]);
        });

        if (userId === ADMIN_ID) {
          const stats = `📊 <b>DATABASE STATS</b>\n━━━━━━━━━━━━━━━━━━━━\n👤 <b>USERS:</b> 1\n📱 <b>RANGES:</b> ${targetGroups.length}\n🔗 <b>GROUPS:</b> ${targetGroups.length}\n🌍 <b>COUNTRIES:</b> 240+\n━━━━━━━━━━━━━━━━━━━━`;
          const adminKeyboard: any = {
            inline_keyboard: [
              [{ text: "📢 BROADCAST", callback_data: "adm_bc_mode", style: "primary" }],
              [{ text: "🔗 GROUP SETTINGS", callback_data: "adm_groups", style: "success" }],
              [{ text: "❌ CLOSE", callback_data: "adm_close", style: "danger" }]
            ]
          };
          await safeBotCall(() => bot!.sendMessage(chatId, stats, { parse_mode: "HTML", reply_markup: adminKeyboard }));
          return;
        }

        await safeBotCall(() => bot!.sendMessage(chatId, `👋 Hello! I am your Telegram Relay Bot.\n\nYour Telegram ID: <code>${userId}</code>\n\nI can forward messages from your linked user account to the target group. Log in via the dashboard to get started.`, { 
          parse_mode: "HTML",
          reply_markup: keyboard
        }));
        return;
      }
      if (text === "/status") {
        const status = `🤖 <b>Bot Status:</b> ${botStatus}\n👤 <b>User Status:</b> ${userStatus}\n🔗 <b>Linked ID:</b> <code>${linkedUserId || "None"}</code>\n🆔 <b>Your ID:</b> <code>${userId}</code>\n🛡️ <b>Admin Status:</b> ${userId === ADMIN_ID ? "✅ Authorized" : "❌ Unauthorized"}`;
        await safeBotCall(() => bot!.sendMessage(chatId, status, { parse_mode: "HTML" }));
        return;
      }
    }

    // Default reply for direct messages that aren't commands and not handled by relay logic
    if (msg.chat.type === 'private' && userId !== linkedUserId && userId !== ADMIN_ID) {
      const keyboard: any = {
        inline_keyboard: [
          [{ text: "📊 Dashboard", url: process.env.VITE_APP_URL || "https://ais-dev-qkzyc2nlcbeaq4bqgqgdf6-484782538497.asia-southeast1.run.app", style: "primary" }]
        ]
      };
      await safeBotCall(() => bot!.sendMessage(chatId, `ℹ️ I am a relay bot. To use me, you must link your account through the dashboard.\n\nYour ID: <code>${userId}</code>`, { 
        parse_mode: "HTML",
        reply_markup: keyboard
      }));
      return;
    }

    if (!isForwardingEnabled || targetGroups.length === 0) return;

    // Relay from the linked user's private chat to the bot
    if (msg.chat.type === 'private' && userId === linkedUserId) {
      try {
        const fullText = msg.text || msg.caption || "";
        
        // Parsing the required information
        const countryMatch = fullText.match(/🌍 Country:\s*(.*)/i);
        const rangeMatch = fullText.match(/Range\s*([A-Z0-9Xx\.]+)/i);
        const serviceMatch = fullText.match(/🔵 Service:\s*(.*)/i);
        
        const country = countryMatch ? countryMatch[1].trim() : "Unknown";
        const range = rangeMatch ? rangeMatch[1].trim() : null;
        let service = serviceMatch ? serviceMatch[1].trim() : null;
        
        // Auto-add Instagram if Facebook is detected
        if (service?.toUpperCase() === "FACEBOOK") {
          service = "FACEBOOK + INSTAGRAM";
        }

        const cleanRange = range ? range.trim() : null;
        
        // Extracting the OTP/Code from the Full SMS section
        const smsSection = fullText.split(/📩 Full SMS:|Full SMS:/i)[1] || "";
        const codeMatch = smsSection.match(/([0-9]{3,8}|[0-9]{3}-[0-9]{3})/);
        const copyCode = codeMatch ? codeMatch[0].trim() : null;

        // If we found the expected patterns, transform the message
        const isRangeReport = !!(countryMatch || rangeMatch);
        
        for (const gid of targetGroups) {
          try {
            const replyMarkup: any = { inline_keyboard: [] };
            
            if (isRangeReport) {
              const safeCb = (prefix: string, val: string) => {
                const data = `${prefix}:${val}`;
                return data.length > 64 ? data.substring(0, 64) : data;
              };

              // Button 1: COPY CODE
              if (copyCode) {
                replyMarkup.inline_keyboard.push([
                  { text: `❐ 📋 COPY: ${copyCode}`, callback_data: safeCb("copy_range", copyCode), style: "primary" }
                ]);
              }

              // Button 2: RANGE
              if (cleanRange && (!copyCode || cleanRange !== copyCode)) {
                replyMarkup.inline_keyboard.push([
                  { text: `❐ 📱 RANGE: ${cleanRange}`, callback_data: safeCb("copy_range", cleanRange), style: "primary" }
                ]);
              }
              
              // Button 3: SERVICE
              if (service && service !== ":" && service.length > 1) {
                replyMarkup.inline_keyboard.push([
                  { text: `🔹 ${service.toUpperCase()}`, callback_data: safeCb("info_service", service.toUpperCase()), style: "success" }
                ]);
              }
            }

            // No extra delay needed here as processBotQueue handles the spacing
            try {
              if (isRangeReport) {
                const body = `🌍 <b>Country:</b> ${country}`;
                await safeBotCall(() => bot!.sendMessage(gid, body, {
                  message_thread_id: targetTopicId,
                  parse_mode: "HTML",
                  reply_markup: replyMarkup
                }));
              } else {
                await safeBotCall(() => bot!.copyMessage(gid, chatId, msg.message_id, {
                  message_thread_id: targetTopicId
                }));
              }
            } catch (e) { 
              console.error(`Relay failed for group ${gid}:`, e);
            }
          } catch (e) { console.error(`Relay error:`, e); }
        }

        // Logs
        const logEntry = {
          id: Date.now(),
          from: msg.forward_from?.username || msg.from?.username || "Telegram User",
          text: fullText,
          time: new Date().toLocaleTimeString(),
        };
        lastForwardedMessages = [logEntry, ...lastForwardedMessages].slice(0, 50);
      } catch (err) {
        console.error("Relay Error:", err);
      }
    }
  });
}

// Function to start user client with persistence
async function startUserClient(sessionStr: string) {
  try {
    client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
      connectionRetries: 5,
      useIPV6: false,
      timeout: 30000
    });
    await client.connect();
    
    // Resolve bot entity to ensure it's in the cache for forwarding
    if (botUsername) {
      try {
        await client.getEntity(botUsername);
      } catch (e) {
        console.warn("Relay resolution warning:", e);
      }
    }

    const me = (await client.getMe()) as any;
    linkedUserId = me.id.toString();
    userStatus = "Active";
    console.log(`User Client connected: @${me.username} (${me.id})`);

    // Save session to file for persistence
    if (sessionStr) {
       fs.writeFileSync(sessionFile, sessionStr);
    }

    client.addEventHandler(async (event) => {
      if (!isForwardingEnabled || !client) return;
      
      const message = event.message;
      if (!message || !message.peerId) return;

      let chatId = "";
      try {
        if (message.peerId.className === "PeerChannel") {
          chatId = `-100${message.peerId.channelId.toString()}`;
        } else if (message.peerId.className === "PeerChat") {
          chatId = `-${message.peerId.chatId.toString()}`;
        }
      } catch (e) { return; }

      // Relay: User account forwards message to Bot
      if (chatId === sourceGroupId && (botUsername || botUserId)) {
        try {
          // Use username if available as it is more likely to resolve if not in cache
          await client.forwardMessages(botUsername || botUserId!, {
            messages: [message.id],
            fromPeer: chatId,
          });
        } catch (err) {
          console.error("User Relay Error:", err);
        }
      }
    }, new NewMessage({}));

  } catch (err) {
    console.error("User Client Start Error:", err);
    userStatus = "Failed";
  }
}

// Auto-load session on start
if (fs.existsSync(sessionFile)) {
  const savedSession = fs.readFileSync(sessionFile, "utf-8");
  if (savedSession) {
    console.log("Found existing session. Connecting...");
    // startUserClient(savedSession);
    console.log("Relay logic is currently DISABLED as per user request to test local script.");
  }
}

// API Endpoints
app.get("/api/session", (req, res) => {
  if (fs.existsSync(sessionFile)) {
    const session = fs.readFileSync(sessionFile, "utf-8");
    let info = {};
    if (fs.existsSync(sessionInfoFile)) {
      try {
        info = JSON.parse(fs.readFileSync(sessionInfoFile, "utf-8"));
      } catch (e) {}
    }
    res.json({ session, ...info });
  } else {
    res.status(404).json({ error: "No session found" });
  }
});

app.post("/api/admin/toggle", (req, res) => {
  if (linkedUserId !== ADMIN_ID) return res.status(403).json({ error: "Unauthorized" });
  isForwardingEnabled = !isForwardingEnabled;
  res.json({ success: true, enabled: isForwardingEnabled });
});

app.post("/api/admin/broadcast", async (req, res) => {
  if (linkedUserId !== ADMIN_ID) return res.status(403).json({ error: "Unauthorized" });
  const { message } = req.body;
  if (!bot || targetGroups.length === 0) return res.status(400).json({ error: "Bot/Target missing" });
  
  try {
    let sentCount = 0;
    for (const gid of targetGroups) {
      try {
        await safeBotCall(() => bot!.sendMessage(gid, `📢 **BROADCAST**\n\n${message}`, { parse_mode: "Markdown" }));
        sentCount++;
      } catch (e) { console.error(`BC failed for ${gid}`, e); }
    }
    res.json({ success: true, sentTo: sentCount });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/login/start", async (req, res) => {
  const { phone } = req.body;
  if (!apiId || !apiHash) return res.status(400).json({ error: "Missing API_ID/API_HASH configuration" });
  
  try {
    if (client) {
      try { await client.disconnect(); } catch (e) {}
    }
    
    // We create a fresh client for every login attempt
    client = new TelegramClient(new StringSession(""), apiId, apiHash, { 
      connectionRetries: 5,
    });
    
    await client.connect();
    // Start login flow
    const result = await client.sendCode({ apiId, apiHash }, phone);
    phoneCodeHash = result.phoneCodeHash;
    res.json({ success: true });
  } catch (err: any) {
    console.error("Login Start Error:", err);
    res.status(500).json({ error: err.message || "Failed to send code." });
  }
});

app.post("/api/login/verify", async (req, res) => {
  const { phone, code, password } = req.body;
  if (!client || !phoneCodeHash) {
    return res.status(400).json({ 
      error: "Session lost due to server restart. Please go back and request a new code." 
    });
  }

  try {
    let result: any;
    try {
      // Try high-level signIn first if available, else fallback to invoke
      if (typeof (client as any).signIn === 'function') {
        result = await (client as any).signIn({
          phoneNumber: phone,
          phoneCodeHash: phoneCodeHash,
          phoneCode: code,
          password: async () => password || "",
        });
      } else {
        result = await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phone,
            phoneCodeHash: phoneCodeHash,
            phoneCode: code,
          })
        );
      }
    } catch (e: any) {
      if (e.message.includes("SESSION_PASSWORD_NEEDED")) {
        if (!password) {
          return res.status(401).json({ error: "2FA Password required. Please enter it and try again." });
        }
        const passwordAttr = await client.invoke(new Api.account.GetPassword());
        const PasswordHelper = await import("telegram/Password.js");
        const srpResult = await PasswordHelper.computeCheck(passwordAttr, password);
        
        result = await client.invoke(
          new Api.auth.CheckPassword({
            password: srpResult,
          })
        );
      } else {
        throw e;
      }
    }

    if (!result) throw new Error("Login failed - no result from Telegram.");

    const sessionString = (client.session as StringSession).save();
    fs.writeFileSync(sessionFile, sessionString);
    
    // Store metadata
    fs.writeFileSync(sessionInfoFile, JSON.stringify({
      phone,
      apiId,
      apiHash
    }));
    
    // Refresh handlers and state
    await startUserClient(sessionString);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Verification Error:", err);
    let errorMessage = err.message || "Verification failed.";
    if (errorMessage.includes("PHONE_CODE_EXPIRED")) errorMessage = "Verification code expired. Please request a new one.";
    if (errorMessage.includes("PHONE_CODE_INVALID")) errorMessage = "Invalid verification code. Please check and try again.";
    res.status(500).json({ error: errorMessage });
  }
});

app.get("/api/status", (req, res) => {
  res.json({
    botStatus,
    userStatus,
    targetGroups,
    sourceGroup: sourceGroupId,
    logs: lastForwardedMessages,
    isForwardingEnabled,
    isAdmin: linkedUserId === ADMIN_ID,
    customMenuButtons
  });
});

app.post("/api/admin/menu", (req, res) => {
  if (linkedUserId !== ADMIN_ID) return res.status(403).json({ error: "Unauthorized" });
  const { buttons } = req.body;
  if (!Array.isArray(buttons)) return res.status(400).json({ error: "Invalid format" });
  customMenuButtons = buttons;
  res.json({ success: true });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

start();

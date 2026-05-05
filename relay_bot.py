import asyncio
import re
import httpx
from telethon import TelegramClient, events
from telethon.sessions import StringSession

# --- CONFIGURATION ---
API_ID = 35959554
API_HASH = "f2704f1b44114f13d5637ed1730ec326"
BOT_TOKEN = "8679304107:AAFuoBO-242kDsdVl_3btH_2Y4du44rfwqE"

# আপনার দেওয়া সেশন স্ট্রিং
SESSION_STRING = "1BAAOMTQ5LjE1NC4xNjcuOTEAULPQ5oZxm8n1cM+sI7TNwSyRh9hQDfT+s7c2bHGMashaAU7MtOoMoHG+KD0axJ2db3Y+TSIajw6kCx77xiuuVKtpvDGRFrCtTtf+J0v9vXsKDHUTpUEQ26XbVK8CZwkuKLD/V7s+HMplyXBMJhhVYPvt1SomzEz2+WCff1a8wbcWMzdtM8CYHfoomYRFCDbR4o5tpaAFttAyRI1pxCcWvjiN1gxT6cKlGAiN5TnEktc5w/zUGKWB12Q6QtNHXUQZqXpTa4HPn0eM/loEKDtg6KPshC20iV0qoDx8ODDP3pczZIXoYRDdfrV9cNKhuyY3uDgbfKZ2pTchWlDEWx1W8GY="

# যে চ্যানেল থেকে মেসেজ নিবে (Source)
SOURCE_CHANNEL_ID = -1003787486402

# যে গ্রুপগুলোতে পাঠাবে (Target)
TARGET_GROUPS = [-1003949536377]

# ----------------------

class BotRelay:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.base_url = f"https://api.telegram.org/bot{BOT_TOKEN}"

    async def send_message(self, chat_id, text, reply_markup=None, retry_count=0):
        url = f"{self.base_url}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "reply_markup": reply_markup
        }
        
        try:
            res = await self.client.post(url, json=payload)
            data = res.json()
            
            if data.get("ok"):
                return data
            
            # Rate Limit Logic (429 handling like server.ts)
            if data.get("error_code") == 429 and retry_count < 5:
                retry_after = (data.get("parameters", {}).get("retry_after", 15) + 2)
                print(f"⚠️ Rate limited. Waiting {retry_after}s before retrying...")
                await asyncio.sleep(retry_after)
                return await self.send_message(chat_id, text, reply_markup, retry_count + 1)
            
            print(f"❌ Telegram Error: {data.get('description')}")
            return None
        except Exception as e:
            print(f"❌ Request Error: {e}")
            return None

relay = BotRelay()

async def main():
    client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)
    
    print("🚀 Connecting to account...")
    await client.connect()
    
    if not await client.is_user_authorized():
        print("❌ Session invalid! App এ গিয়ে নতুন করে লিঙ্ক করুন।")
        return

    me = await client.get_me()
    print(f"✅ Logged in as: {me.first_name}")
    print(f"📡 Listening to SOURCE: {SOURCE_CHANNEL_ID}")

    @client.on(events.NewMessage(chats=SOURCE_CHANNEL_ID))
    async def handler(event):
        full_text = event.message.text or ""
        
        # --- Extraction Logic (Exactly like server.ts) ---
        country_match = re.search(r"🌍 Country:\s*(.*)", full_text, re.IGNORECASE)
        range_match = re.search(r"Range\s*([A-Z0-9Xx\.]+)", full_text, re.IGNORECASE)
        service_match = re.search(r"🔵 Service:\s*(.*)", full_text, re.IGNORECASE)
        
        country = country_match.group(1).strip() if country_match else "Unknown"
        range_val = range_match.group(1).strip() if range_match else None
        service = service_match.group(1).strip() if service_match else None
        
        if service and service.upper() == "FACEBOOK":
            service = "FACEBOOK + INSTAGRAM"
            
        sms_parts = re.split(r"📩 Full SMS:|Full SMS:", full_text, flags=re.IGNORECASE)
        sms_section = sms_parts[1] if len(sms_parts) > 1 else ""
        code_match = re.search(r"([0-9]{3,8}|[0-9]{3}-[0-9]{3})", sms_section)
        copy_code = code_match.group(0).strip() if code_match else None
        
        is_range_report = bool(country_match or range_match)
        
        if is_range_report:
            reply_markup = {"inline_keyboard": []}
            
            # Button 1: COPY CODE
            if copy_code:
                reply_markup["inline_keyboard"].append([
                    {"text": f"❐ 📋 COPY: {copy_code}", "callback_data": f"copy_range:{copy_code}", "style": "primary"}
                ])
                
            # Button 2: RANGE
            if range_val and range_val != copy_code:
                reply_markup["inline_keyboard"].append([
                    {"text": f"❐ 📱 RANGE: {range_val}", "callback_data": f"copy_range:{range_val}", "style": "primary"}
                ])
                
            # Button 3: SERVICE
            if service and service != ":" and len(service) > 1:
                reply_markup["inline_keyboard"].append([
                    {"text": f"🔹 {service.upper()}", "callback_data": f"info_service:{service.upper()}", "style": "success"}
                ])
                
            body = f"🌍 <b>Country:</b> {country}"
            
            for gid in TARGET_GROUPS:
                print(f"📤 Relaying to {gid}...")
                await relay.send_message(gid, body, reply_markup)
                await asyncio.sleep(0.350) # Matching server.ts success delay

    print("🤖 Bot is active. Press Ctrl+C to stop.")
    await client.run_until_disconnected()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Bot stopped.")

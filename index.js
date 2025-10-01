import TelegramBot from "node-telegram-bot-api";
import express from "express";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import dotenv from "dotenv";
import { nanoid } from "nanoid";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();
app.use(express.json());
app.use(cors());

// static public folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// database
const adapter = new JSONFile("db.json");
const db = new Low(adapter, { 
  users: [], 
  products: [], 
  orders: [], 
  drivers: [], 
  areas: [], 
  driverApplications: [], 
  invoices: [] 
});
await db.read();
await db.write();

// helper
function getOrCreateUser(telegramId) {
  let user = db.data.users.find(u => u.telegramId === telegramId);
  if (!user) {
    user = { telegramId, points: 0, createdAt: new Date().toISOString() };
    db.data.users.push(user);
  }
  return user;
}

// main menu
bot.onText(/\/start/, (msg) => {
  getOrCreateUser(msg.from.id);
  bot.sendMessage(msg.chat.id, "👋 أهلاً بك! استخدم الأزرار:", {
    reply_markup: {
      keyboard: [
        ["🛒 المنتجات الداخلية", "➕ أضف سلعة"],
        ["🏍️ تسجيل دليفري", "💳 شحن المحفظة"],
        ["💵 سحب النسبة", "👨‍💼 لوحة الأدمن"]
      ],
      resize_keyboard: true
    }
  });
});

// handle web_app_data
bot.on("web_app_data", async (msg) => {
  try {
    const data = JSON.parse(msg.web_app_data.data);
    const userId = msg.from.id;

    // تسجيل دليفري
    if (data.action === "driver_register") {
      if (!data.payerName || !data.payerPhone || !data.paymentReceipt) {
        return bot.sendMessage(userId, "❌ يجب دفع رسوم التسجيل وإرفاق (الاسم + رقم المرسل + صورة الإيصال).");
      }
      db.data.driverApplications.push({
        appId: nanoid(8),
        userId,
        name: data.name,
        age: data.age,
        phone: data.phone,
        areaId: data.areaId,
        username: data.username,
        location: data.location,
        idFront: data.idFront,
        idBack: data.idBack,
        license: data.license,
        bike: data.bike,
        payerName: data.payerName,
        payerPhone: data.payerPhone,
        paymentReceipt: data.paymentReceipt,
        status: "pending",
        createdAt: new Date().toISOString()
      });
      db.data.invoices.push({
        id: nanoid(10),
        userId,
        type: "driver_register_fee",
        amount: 20, // رسوم التسجيل
        payerName: data.payerName,
        payerPhone: data.payerPhone,
        receipt: data.paymentReceipt,
        status: "pending",
        createdAt: new Date().toISOString()
      });
      await db.write();
      return bot.sendMessage(userId, "✅ تم إرسال طلب التسجيل مع بيانات الدفع للمراجعة.");
    }

    // إضافة سلعة
    if (data.action === "add_product") {
      if (!data.payerName || !data.payerPhone || !data.paymentReceipt) {
        return bot.sendMessage(userId, "❌ يجب دفع رسوم إضافة السلعة وإرفاق (الاسم + رقم المرسل + صورة الإيصال).");
      }
      const sku = nanoid(8);
      db.data.products.push({
        sku,
        title: data.title,
        desc: data.desc,
        price: data.price,
        ownerId: userId,
        photo: data.photo,
        createdAt: new Date().toISOString()
      });
      db.data.invoices.push({
        id: nanoid(10),
        userId,
        type: "product_publish_fee",
        amount: 5,
        payerName: data.payerName,
        payerPhone: data.payerPhone,
        receipt: data.paymentReceipt,
        status: "pending",
        createdAt: new Date().toISOString()
      });
      await db.write();
      return bot.sendMessage(userId, "✅ تم إضافة السلعة، بانتظار مراجعة الدفع.");
    }

    // شحن المحفظة
    if (data.action === "charge_wallet") {
      if (!data.payerName || !data.payerPhone || !data.paymentReceipt) {
        return bot.sendMessage(userId, "❌ يجب إدخال بيانات الدفع (الاسم + رقم المرسل + صورة الإيصال).");
      }
      db.data.invoices.push({
        id: nanoid(10),
        userId,
        type: "wallet_charge",
        amount: data.amount,
        payerName: data.payerName,
        payerPhone: data.payerPhone,
        receipt: data.paymentReceipt,
        status: "pending",
        createdAt: new Date().toISOString()
      });
      await db.write();
      return bot.sendMessage(userId, "✅ تم تسجيل طلب الشحن، بانتظار مراجعة الدفع.");
    }

    // سحب النسبة
    if (data.action === "withdraw") {
      if (!data.payerName || !data.payerPhone || !data.paymentReceipt) {
        return bot.sendMessage(userId, "❌ يجب إدخال بيانات الدفع (الاسم + رقم المرسل + صورة الإيصال).");
      }
      db.data.invoices.push({
        id: nanoid(10),
        userId,
        type: "withdraw_request",
        amount: data.amount,
        payerName: data.payerName,
        payerPhone: data.payerPhone,
        receipt: data.paymentReceipt,
        status: "pending",
        createdAt: new Date().toISOString()
      });
      await db.write();
      return bot.sendMessage(userId, "✅ تم إرسال طلب السحب مع بيانات الدفع للمراجعة.");
    }

  } catch (e) {
    console.error("❌ web_app_data error:", e);
  }
});

// API للأدمن لمراجعة الفواتير
app.get("/api/admin/invoices", (req, res) => {
  res.json({ invoices: db.data.invoices });
});

app.post("/api/admin/invoices/confirm", async (req, res) => {
  const { id } = req.body;
  const inv = db.data.invoices.find(i => i.id === id);
  if (!inv) return res.status(404).json({ ok: false });
  inv.status = "confirmed";
  await db.write();
  res.json({ ok: true });
});

app.post("/api/admin/invoices/reject", async (req, res) => {
  const { id } = req.body;
  const inv = db.data.invoices.find(i => i.id === id);
  if (!inv) return res.status(404).json({ ok: false });
  inv.status = "rejected";
  await db.write();
  res.json({ ok: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running on port " + (process.env.PORT || 3000));
});

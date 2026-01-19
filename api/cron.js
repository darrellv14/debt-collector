// api/cron.js

export default async function handler(request, response) {
  // --- KONFIGURASI DARI ENV ---
  const SHEET_ID = process.env.SHEET_ID;
  const GID_TAGIHAN = process.env.GID_TAGIHAN || process.env.GID_REKAP;
  const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
  const TARGET_WA = process.env.TARGET_WA;

  if (!SHEET_ID || !FONNTE_TOKEN || !TARGET_WA) {
    return response.status(500).json({ error: "Env Vars belum lengkap." });
  }

  try {
    // 1. Ambil Data TAGIHAN
    const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID_TAGIHAN}`;
    const sheetResponse = await fetch(csvUrl);
    if (!sheetResponse.ok) throw new Error("Gagal ambil data Sheet");

    const csvText = await sheetResponse.text();
    const rows = csvText.split("\n").map((row) => {
      const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
      return row.split(regex).map((cell) => cell.replace(/^"|"$/g, "").trim());
    });

    // 2. Agregasi Utang
    const debtSummary = {};

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 7) continue;

      const nama = row[2]; // Kolom C
      const nominalStr = row[4]; // Kolom E
      const status = row[6]; // Kolom G

      if (status && status.toUpperCase().includes("BELUM")) {
        const nominal = parseInt(nominalStr.replace(/[^\d]/g, "")) || 0;
        if (debtSummary[nama]) {
          debtSummary[nama] += nominal;
        } else {
          debtSummary[nama] = nominal;
        }
      }
    }

    const debtors = Object.keys(debtSummary);
    if (debtors.length === 0) {
      return response.status(200).json({ status: "Lunas semua." });
    }

    // 3. FORMAT PESAN (LEBIH RAPI & ADA JAM)
    const now = new Date();
    const dateStr = now.toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });
    const timeStr = now
      .toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
        timeZone: "Asia/Jakarta",
      })
      .replace(".", ":"); // Format jam Indonesia biasanya pakai titik, kita ganti titik dua biar standar jam digital

    let message = `🔔 *REMINDER TAGIHAN* 🔔\n`;
    message += `📅 ${dateStr}\n`;
    message += `⏰ Pukul ${timeStr}\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `Halo bestie! 👋 Berikut list yang statusnya masih *BELUM LUNAS*:\n\n`;

    let no = 1;
    let totalUtangSemua = 0;

    for (const [nama, total] of Object.entries(debtSummary)) {
      totalUtangSemua += total;
      const totalFormatted = new Intl.NumberFormat("id-ID").format(total);
      // Nama dibold, nominal pakai monospace (kalau support) atau biasa
      message += `${no++}. *${nama}*\n`;
      message += `   💸 Rp ${totalFormatted}\n`;
    }

    const totalAllFormatted = new Intl.NumberFormat("id-ID").format(
      totalUtangSemua,
    );
    message += `\n💰 *Total Pending: Rp ${totalAllFormatted}*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `Mohon segera transfer ya! Cek detailnya di sini:\n`;
    message += `🔗 https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${GID_TAGIHAN}\n`;
    message += `\n_Automated Message by Moocuan Bot_ 🤖 created by Delvin`;

    // 4. Kirim ke Fonnte
    const fonnteResponse = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: FONNTE_TOKEN },
      body: new URLSearchParams({
        target: TARGET_WA,
        message: message,
        countryCode: "62",
      }),
    });

    const fonnteResult = await fonnteResponse.json();
    return response
      .status(200)
      .json({ success: true, summary: debtSummary, fonnte: fonnteResult });
  } catch (error) {
    console.error("Error:", error);
    return response.status(500).json({ error: error.message });
  }
}

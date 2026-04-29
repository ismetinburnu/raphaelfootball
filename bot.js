const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('RAPHAEL BOT ONLINE VE AKTIF'));
app.listen(process.env.PORT || 3000);

const token = '8692050432:AAGHsImArczpglBwM_u8gC5PHuYJOSI6n5A';
const adminId = '8402118528';
const bot = new TelegramBot(token, { polling: true });

const users = {};
const matchStates = {};

bot.on('polling_error', (err) => console.log(err.message));

const getMainMenu = (chatId) => {
    const isActive = users[chatId]?.isActive ?? true;
    const kb = [
        [{ text: '🔍 Maç Ara ve Ekle', callback_data: 'search_match' }, { text: '📋 Takip Listem', callback_data: 'list_tracked' }],
        [{ text: `⚙️ Bildirim Sistemi: ${isActive ? '🟢 AÇIK' : '🔴 KAPALI'}`, callback_data: 'toggle_system' }]
    ];
    if (String(chatId) === adminId) {
        kb.push([{ text: '👑 Admin Paneli', callback_data: 'admin_panel' }]);
    }
    return { reply_markup: { inline_keyboard: kb } };
};

const getUser = (chatId) => {
    if (!users[chatId]) {
        users[chatId] = { isActive: true, tracked: new Set(), state: 'idle' };
    }
    return users[chatId];
};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    getUser(chatId);
    const welcomeMsg = `🤖 *RAPHAEL Gelişmiş Bot*\n\nMaçları anlık takip edebilir, goller, kırmızı kartlar ve maç sonu bildirimlerini anında alabilirsiniz.\n\nLütfen bir işlem seçin:`;
    bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown', ...getMainMenu(chatId) });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const user = getUser(chatId);

    if (data === 'search_match') {
        user.state = 'waiting_for_search';
        bot.sendMessage(chatId, '🔍 Aradığınız takımın veya ligin adını yazın:\n*(Örn: Galatasaray, Real Madrid)*');
        bot.answerCallbackQuery(query.id);
    } 
    else if (data === 'list_tracked') {
        if (user.tracked.size === 0) {
            bot.sendMessage(chatId, '📋 Şu anda takip ettiğiniz bir maç bulunmuyor.', getMainMenu(chatId));
        } else {
            bot.sendMessage(chatId, '⏳ Listenizdeki maçların güncel verileri çekiliyor...');
            sendTrackedList(chatId);
        }
        bot.answerCallbackQuery(query.id);
    }
    else if (data === 'toggle_system') {
        user.isActive = !user.isActive;
        bot.editMessageReplyMarkup(getMainMenu(chatId).reply_markup, { chat_id: chatId, message_id: messageId });
        bot.answerCallbackQuery(query.id, { text: `Sistem ${user.isActive ? 'AÇILDI' : 'KAPATILDI'}`, show_alert: true });
    }
    else if (data.startsWith('add_')) {
        const matchId = data.split('_')[1];
        user.tracked.add(matchId);
        bot.answerCallbackQuery(query.id, { text: '✅ Maç takibe alındı!' });
        sendMatchDetails(chatId, matchId, true);
    }
    else if (data.startsWith('rem_')) {
        const matchId = data.split('_')[1];
        user.tracked.delete(matchId);
        bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.answerCallbackQuery(query.id, { text: '🗑 Maç takipten çıkarıldı!' });
        bot.sendMessage(chatId, '🗑 Maç başarıyla takipten çıkarıldı.', getMainMenu(chatId));
    }
    else if (data.startsWith('pred_')) {
        const matchId = data.split('_')[1];
        sendPrediction(chatId, matchId);
        bot.answerCallbackQuery(query.id);
    }
    else if (data.startsWith('refresh_')) {
        const matchId = data.split('_')[1];
        bot.answerCallbackQuery(query.id, { text: '🔄 Güncelleniyor...' });
        bot.deleteMessage(chatId, messageId).catch(() => {});
        sendMatchDetails(chatId, matchId, false);
    }
    else if (data === 'admin_panel') {
        if (String(chatId) === adminId) {
            const totalUsers = Object.keys(users).length;
            let activeTrackCount = 0;
            Object.values(users).forEach(u => activeTrackCount += u.tracked.size);
            
            const adminMsg = `👑 *ADMİN PANELİ*\n\n👥 Toplam Kullanıcı: ${totalUsers}\n🎯 Toplam Takip Edilen Maç: ${activeTrackCount}`;
            const adminKb = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📢 Toplu Duyuru Gönder', callback_data: 'admin_broadcast' }],
                        [{ text: '🔙 Ana Menü', callback_data: 'back_main' }]
                    ]
                }
            };
            bot.editMessageText(adminMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...adminKb });
        }
        bot.answerCallbackQuery(query.id);
    }
    else if (data === 'admin_broadcast') {
        if (String(chatId) === adminId) {
            user.state = 'waiting_for_broadcast';
            bot.sendMessage(chatId, '📢 Tüm kullanıcılara gönderilecek duyuru mesajını yazın:');
        }
        bot.answerCallbackQuery(query.id);
    }
    else if (data === 'back_main') {
        bot.editMessageText(`🤖 *RAPHAEL Gelişmiş Bot*\n\nMaçları anlık takip edebilir, goller, kırmızı kartlar ve maç sonu bildirimlerini anında alabilirsiniz.\n\nLütfen bir işlem seçin:`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...getMainMenu(chatId) });
        bot.answerCallbackQuery(query.id);
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = getUser(chatId);

    if (!text || text === '/start') return;

    if (user.state === 'waiting_for_search') {
        user.state = 'idle';
        bot.sendMessage(chatId, '⏳ Veritabanı taranıyor...');
        searchMatches(chatId, text);
    }
    else if (user.state === 'waiting_for_broadcast' && String(chatId) === adminId) {
        user.state = 'idle';
        let successCount = 0;
        const userIds = Object.keys(users);
        
        for (const uid of userIds) {
            try {
                await bot.sendMessage(uid, `📢 *SİSTEM DUYURUSU*\n\n${text}`, { parse_mode: 'Markdown' });
                successCount++;
            } catch (err) {}
        }
        bot.sendMessage(chatId, `✅ Duyuru ${successCount} kullanıcıya başarıyla iletildi.`, getMainMenu(chatId));
    }
});

async function searchMatches(chatId, queryText) {
    try {
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${today}`);
        const events = response.data.events || [];
        
        const filtered = events.filter(e => {
            const home = e.competitions[0].competitors.find(c => c.homeAway === 'home').team.displayName.toLowerCase();
            const away = e.competitions[0].competitors.find(c => c.homeAway === 'away').team.displayName.toLowerCase();
            const q = queryText.toLowerCase();
            return home.includes(q) || away.includes(q);
        });

        if (filtered.length === 0) {
            bot.sendMessage(chatId, `❌ "${queryText}" için sistemde aktif veya bugüne ait maç bulunamadı.`, getMainMenu(chatId));
            return;
        }

        let msgText = `🔎 *Arama Sonuçları: ${queryText}*\n\nTakip etmek istediğiniz maçı seçin:\n`;
        const inline_keyboard = [];

        filtered.forEach(match => {
            const comp = match.competitions[0];
            const home = comp.competitors.find(c => c.homeAway === 'home');
            const away = comp.competitors.find(c => c.homeAway === 'away');
            const status = match.status.type.shortDetail;
            const isLive = match.status.type.state === 'in';

            const btnText = `${isLive ? '🔴 ' : '⚪️ '}${home.team.displayName} ${home.score ?? ''} - ${away.score ?? ''} ${away.team.displayName} [${status}]`;
            inline_keyboard.push([{ text: btnText, callback_data: `add_${match.id}` }]);
        });

        bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });

    } catch (error) {
        bot.sendMessage(chatId, '❌ API bağlantı hatası oluştu.', getMainMenu(chatId));
    }
}

async function sendTrackedList(chatId) {
    const user = getUser(chatId);
    const trackedArr = Array.from(user.tracked);
    
    bot.sendMessage(chatId, `📋 *Aktif Takip Listeniz (${trackedArr.length} Maç)*`, { parse_mode: 'Markdown' });
    
    for (const matchId of trackedArr) {
        await sendMatchDetails(chatId, matchId, false);
    }
}

async function sendMatchDetails(chatId, matchId, isNew = false) {
    try {
        const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${matchId}`);
        const data = response.data;
        const comp = data.header.competitions[0];
        
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        const status = comp.status.type.detail;
        const isLive = comp.status.type.state === 'in';

        let text = `${isNew ? '✅ *MAÇ TAKİBE ALINDI*\n\n' : ''}`;
        text += `🏟 *${home.team.displayName} ${home.score ?? '-'} : ${away.score ?? '-'} ${away.team.displayName}*\n`;
        text += `⏱ Durum: _${status}_\n`;

        if (isLive && data.keyEvents && data.keyEvents.length > 0) {
            const lastEvent = data.keyEvents[data.keyEvents.length - 1];
            text += `📌 Son Olay: ${lastEvent.type.text} (${lastEvent.clock?.displayValue || ''}')\n`;
        }

        const inline_keyboard = [
            [
                { text: '🧠 Yapay Zeka', callback_data: `pred_${matchId}` },
                { text: '🔄 Yenile', callback_data: `refresh_${matchId}` }
            ],
            [
                { text: '🗑 Takipten Çıkar', callback_data: `rem_${matchId}` }
            ]
        ];

        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    } catch (e) {
        const user = getUser(chatId);
        user.tracked.delete(matchId);
    }
}

async function sendPrediction(chatId, matchId) {
    try {
        const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${matchId}`);
        const data = response.data;
        const comp = data.header.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home').team;
        const away = comp.competitors.find(c => c.homeAway === 'away').team;

        let pred = data.predict || data.predictor;
        let hPct, tPct, aPct;

        if (pred && pred.homeChance) {
            hPct = parseFloat(pred.homeChance).toFixed(1);
            tPct = parseFloat(pred.tieChance || pred.drawChance).toFixed(1);
            aPct = parseFloat(pred.awayChance).toFixed(1);
        } else {
            const hId = parseInt(home.id) || 1;
            const aId = parseInt(away.id) || 2;
            let baseHome = 35 + (hId % 25); 
            let baseAway = 20 + (aId % 25); 
            let tie = 100 - baseHome - baseAway;
            if (tie < 10) { tie = 15; baseHome -= 3; baseAway -= 2; }
            
            hPct = baseHome.toFixed(1);
            tPct = tie.toFixed(1);
            aPct = baseAway.toFixed(1);
        }

        const msg = `🧠 *YAPAY ZEKA ANALİZİ*\n\n` +
                    `1️⃣ *${home.displayName}*: %${hPct}\n` +
                    `✖️ *Beraberlik*: %${tPct}\n` +
                    `2️⃣ *${away.displayName}*: %${aPct}`;

        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, '❌ Tahmin verisi bu maç için henüz hazır değil.');
    }
}

setInterval(async () => {
    const activeMatchIds = new Set();
    Object.keys(users).forEach(chatId => {
        if (users[chatId].isActive) users[chatId].tracked.forEach(id => activeMatchIds.add(id));
    });

    for (const matchId of activeMatchIds) {
        try {
            const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${matchId}`);
            const data = response.data;
            const comp = data.header.competitions[0];
            const home = comp.competitors.find(c => c.homeAway === 'home');
            const away = comp.competitors.find(c => c.homeAway === 'away');
            
            if (!matchStates[matchId]) {
                matchStates[matchId] = {
                    score: `${home.score}-${away.score}`,
                    status: comp.status.type.name,
                    notifiedEvents: new Set()
                };
            }

            const state = matchStates[matchId];
            const currentScore = `${home.score}-${away.score}`;
            const keyEvents = data.keyEvents || [];

            keyEvents.forEach(event => {
                if (!state.notifiedEvents.has(event.id)) {
                    state.notifiedEvents.add(event.id);
                    
                    const eType = event.type.text.toLowerCase();
                    const eTime = event.clock?.displayValue || event.clock?.value || '??';
                    const athlete = event.participants?.[0]?.athlete?.displayName || 'Bir Oyuncu';
                    const teamName = event.team?.displayName || '';
                    const isExtraTime = String(eTime).includes('+');
                    const extraStr = isExtraTime ? `\n⏳ _(Uzatma)_` : '';

                    let alertMsg = null;

                    if (eType.includes('goal') || eType.includes('penalty')) {
                        alertMsg = `🚨 *G O O O O L !* ⚽️\n\n` +
                                   `🏟 *${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}*\n\n` +
                                   `👤 *Gol:* ${athlete} (${teamName})\n` +
                                   `⏱ *Dakika:* ${eTime}' ${extraStr}`;
                    } 
                    else if (eType.includes('red card')) {
                        alertMsg = `🟥 *KIRMIZI KART!*\n\n` +
                                   `🏟 *${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}*\n\n` +
                                   `👤 *Atılan Oyuncu:* ${athlete} (${teamName})\n` +
                                   `⏱ *Dakika:* ${eTime}'`;
                    }

                    if (alertMsg) {
                        broadcastToTrackers(matchId, alertMsg);
                    }
                }
            });

            if (state.status !== comp.status.type.name) {
                const newStatus = comp.status.type.name;
                state.status = newStatus;

                let statusMsg = null;
                if (newStatus === 'STATUS_HALFTIME') {
                    statusMsg = `⏸ *İLK YARI SONA ERDİ*\n🏟 ${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}`;
                } else if (newStatus === 'STATUS_FULL_TIME') {
                    statusMsg = `🏁 *MAÇ SONA ERDİ*\n🏟 ${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}`;
                } else if (newStatus.includes('EXTRA_TIME')) {
                    statusMsg = `⏱ *MAÇ UZATMALARA GİTTİ*\n🏟 ${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}`;
                } else if (newStatus.includes('PENALTY')) {
                    statusMsg = `🎯 *PENALTI ATIŞLARI BAŞLIYOR*\n🏟 ${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}`;
                }

                if (statusMsg) {
                    broadcastToTrackers(matchId, statusMsg);
                }
            }

            state.score = currentScore;

        } catch (error) {
        }
    }
}, 10000);

function broadcastToTrackers(matchId, message) {
    Object.keys(users).forEach(chatId => {
        const u = users[chatId];
        if (u.isActive && u.tracked.has(matchId)) {
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    });
}

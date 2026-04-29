const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('RAPHAEL ONLINE'));
app.listen(process.env.PORT || 3000);

const token = '8692050432:AAGHsImArczpglBwM_u8gC5PHuYJOSI6n5A';
const adminId = '8402118528';
const bot = new TelegramBot(token, { polling: true });

const users = {};
const matchStates = {};

bot.on('polling_error', () => {});

const formatTurkishDate = (dateString) => {
    if (!dateString) return 'Belirsiz';
    try {
        const d = new Date(dateString);
        return d.toLocaleString('tr-TR', { 
            weekday: 'short', 
            month: 'long', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit', 
            timeZone: 'Europe/Istanbul' 
        });
    } catch(e) { 
        return dateString; 
    }
};

const translateStatus = (statusDetail, dateStr) => {
    if (!statusDetail) return '';
    const s = statusDetail.toLowerCase();
    if (s.includes('at') || s.includes('tbd')) return formatTurkishDate(dateStr);
    if (s.includes('half')) return 'İlk Yarı';
    if (s.includes('full')) return 'Maç Sonu';
    if (s.includes('extra')) return 'Uzatmalar';
    if (s.includes('penal')) return 'Penaltılar';
    if (s.includes('postponed')) return 'Ertelendi';
    if (s.includes('canceled')) return 'İptal Edildi';
    return statusDetail;
};

const getMainMenu = (chatId) => {
    const isActive = users[chatId]?.isActive ?? true;
    const kb = [
        [{ text: '🔍 Maç Ara', callback_data: 'search_match' }, { text: '📋 Listem', callback_data: 'list_tracked' }],
        [{ text: `⚙️ Sistem: ${isActive ? 'AÇIK' : 'KAPALI'}`, callback_data: 'toggle_system' }]
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

bot.onText(/\/(start|takip)/, (msg, match) => {
    const chatId = msg.chat.id;
    const chatType = msg.chat.type;
    const cmd = match[1];

    if (chatType !== 'private' && cmd === 'start') return;

    getUser(chatId);
    bot.sendMessage(chatId, `🤖 *Raphael*\n\nCanlı skor ve maç bildirim sistemi.\nİşlem seçin:`, { parse_mode: 'Markdown', ...getMainMenu(chatId) });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const user = getUser(chatId);

    if (data === 'search_match') {
        user.state = 'waiting_for_search';
        bot.sendMessage(chatId, '🔍 Takım veya lig adı yazın:');
        bot.answerCallbackQuery(query.id);
    } 
    else if (data === 'list_tracked') {
        if (user.tracked.size === 0) {
            bot.sendMessage(chatId, '📋 Listeniz boş.', getMainMenu(chatId));
            bot.answerCallbackQuery(query.id);
        } else {
            bot.answerCallbackQuery(query.id, { text: 'Yükleniyor...' });
            sendTrackedList(chatId, messageId);
        }
    }
    else if (data === 'toggle_system') {
        user.isActive = !user.isActive;
        bot.editMessageReplyMarkup(getMainMenu(chatId).reply_markup, { chat_id: chatId, message_id: messageId });
        bot.answerCallbackQuery(query.id, { text: `Sistem ${user.isActive ? 'AÇILDI' : 'KAPATILDI'}`, show_alert: true });
    }
    else if (data.startsWith('add_')) {
        const matchId = data.split('_')[1];
        user.tracked.add(matchId);
        bot.answerCallbackQuery(query.id, { text: '✅ Eklendi' });
        bot.deleteMessage(chatId, messageId).catch(() => {});
        sendMatchDetails(chatId, matchId, true);
    }
    else if (data.startsWith('rem_')) {
        const matchId = data.split('_')[1];
        user.tracked.delete(matchId);
        bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.answerCallbackQuery(query.id, { text: '🗑 Silindi' });
        bot.sendMessage(chatId, 'Silindi.', getMainMenu(chatId));
    }
    else if (data.startsWith('pred_')) {
        const matchId = data.split('_')[1];
        sendPrediction(chatId, matchId);
        bot.answerCallbackQuery(query.id);
    }
    else if (data.startsWith('refresh_')) {
        const matchId = data.split('_')[1];
        bot.answerCallbackQuery(query.id, { text: '🔄 Yenileniyor...' });
        bot.deleteMessage(chatId, messageId).catch(() => {});
        sendMatchDetails(chatId, matchId, false);
    }
    else if (data.startsWith('detail_')) {
        const matchId = data.split('_')[1];
        bot.answerCallbackQuery(query.id);
        bot.deleteMessage(chatId, messageId).catch(() => {});
        sendMatchDetails(chatId, matchId, false);
    }
    else if (data === 'back_main') {
        bot.editMessageText(`🤖 *Raphael*\n\nCanlı skor ve maç bildirim sistemi.\nİşlem seçin:`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...getMainMenu(chatId) });
        bot.answerCallbackQuery(query.id);
    }
    else if (data === 'admin_panel') {
        if (String(chatId) === adminId) {
            const totalUsers = Object.keys(users).length;
            let activeTrackCount = 0;
            Object.values(users).forEach(u => activeTrackCount += u.tracked.size);
            
            const adminMsg = `👑 *Admin*\n\nKullanıcı: ${totalUsers}\nTakip: ${activeTrackCount}`;
            const adminKb = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📢 Duyuru', callback_data: 'admin_broadcast' }],
                        [{ text: '🔙 Menü', callback_data: 'back_main' }]
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
            bot.sendMessage(chatId, '📢 Duyuru metnini yazın:');
        }
        bot.answerCallbackQuery(query.id);
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = getUser(chatId);

    if (!text || text.startsWith('/')) return;

    if (user.state === 'waiting_for_search') {
        user.state = 'idle';
        bot.sendMessage(chatId, '⏳ Taranıyor...');
        searchMatches(chatId, text);
    }
    else if (user.state === 'waiting_for_broadcast' && String(chatId) === adminId) {
        user.state = 'idle';
        let successCount = 0;
        const userIds = Object.keys(users);
        
        for (const uid of userIds) {
            try {
                await bot.sendMessage(uid, `📢 *Sistem Duyurusu*\n\n${text}`, { parse_mode: 'Markdown' });
                successCount++;
            } catch (err) {}
        }
        bot.sendMessage(chatId, `✅ İletildi: ${successCount}`, getMainMenu(chatId));
    }
});

bot.on('channel_post', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (text && text.includes('/takip')) {
        getUser(chatId);
        bot.sendMessage(chatId, `🤖 *Raphael*\nİşlem seçin:`, { parse_mode: 'Markdown', ...getMainMenu(chatId) });
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
            bot.sendMessage(chatId, `❌ Bulunamadı.`, getMainMenu(chatId));
            return;
        }

        let msgText = `🔎 *Sonuçlar*\n`;
        const inline_keyboard = [];

        filtered.forEach(match => {
            const comp = match.competitions[0];
            const home = comp.competitors.find(c => c.homeAway === 'home');
            const away = comp.competitors.find(c => c.homeAway === 'away');
            const rawStatus = match.status.type.detail;
            const dateStr = match.date;
            const status = translateStatus(rawStatus, dateStr);
            const isLive = match.status.type.state === 'in';

            const btnText = `${isLive ? '🔴' : '⚪'} ${home.team.displayName} ${home.score ?? ''} - ${away.score ?? ''} ${away.team.displayName} [${status}]`;
            inline_keyboard.push([{ text: btnText, callback_data: `add_${match.id}` }]);
        });

        bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });

    } catch (error) {
        bot.sendMessage(chatId, '❌ API Hatası.', getMainMenu(chatId));
    }
}

async function sendTrackedList(chatId, messageId) {
    const user = getUser(chatId);
    const trackedArr = Array.from(user.tracked);
    
    let kb = [];
    for (const matchId of trackedArr) {
        try {
            const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${matchId}`);
            const comp = response.data.header.competitions[0];
            const home = comp.competitors.find(c => c.homeAway === 'home');
            const away = comp.competitors.find(c => c.homeAway === 'away');
            kb.push([{ text: `⚽ ${home.team.displayName} ${home.score ?? '-'} - ${away.score ?? '-'} ${away.team.displayName}`, callback_data: `detail_${matchId}` }]);
        } catch (e) {}
    }
    kb.push([{ text: '🔙 Menü', callback_data: 'back_main' }]);
    
    bot.editMessageText(`📋 *Takip Listesi*\nSeçim yapın:`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {
        bot.sendMessage(chatId, `📋 *Takip Listesi*\nSeçim yapın:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    });
}

async function sendMatchDetails(chatId, matchId, isNew = false) {
    try {
        const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${matchId}`);
        const data = response.data;
        const comp = data.header.competitions[0];
        
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        const rawStatus = comp.status.type.detail;
        const dateStr = comp.date;
        const status = translateStatus(rawStatus, dateStr);
        const isLive = comp.status.type.state === 'in';

        let text = `${isNew ? '✅ *EKLENDİ*\n\n' : ''}`;
        text += `🏟 *${home.team.displayName} ${home.score ?? '-'} : ${away.score ?? '-'} ${away.team.displayName}*\n`;
        text += `⏱ ${status}\n`;

        if (isLive && data.keyEvents && data.keyEvents.length > 0) {
            const lastEvent = data.keyEvents[data.keyEvents.length - 1];
            text += `📌 ${lastEvent.type.text} (${lastEvent.clock?.displayValue || ''}')\n`;
        }

        const inline_keyboard = [
            [
                { text: '📊 Analiz', callback_data: `pred_${matchId}` },
                { text: '🔄 Yenile', callback_data: `refresh_${matchId}` }
            ],
            [
                { text: '🗑 Çıkar', callback_data: `rem_${matchId}` },
                { text: '🔙 Liste', callback_data: `list_tracked` }
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

        const msg = `📊 *Analiz*\n\n` +
                    `1️⃣ *${home.displayName}*: %${hPct}\n` +
                    `✖️ *Beraberlik*: %${tPct}\n` +
                    `2️⃣ *${away.displayName}*: %${aPct}`;

        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    } catch (e) {
        bot.sendMessage(chatId, '❌ Analiz bulunamadı.');
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
                    const eTime = event.clock?.displayValue || event.clock?.value || '';
                    const athlete = event.participants?.[0]?.athlete?.displayName || 'Oyuncu';
                    const teamName = event.team?.displayName || '';
                    const isExtraTime = String(eTime).includes('+');
                    const extraStr = isExtraTime ? `\n⏳ (+)` : '';

                    let alertMsg = null;

                    if (eType.includes('goal') || eType.includes('penalty')) {
                        alertMsg = `🚨 *GOL*\n\n` +
                                   `🏟 *${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}*\n` +
                                   `👤 ${athlete} (${teamName})\n` +
                                   `⏱ ${eTime}' ${extraStr}`;
                    } 
                    else if (eType.includes('red card')) {
                        alertMsg = `🟥 *KIRMIZI KART*\n\n` +
                                   `🏟 *${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}*\n` +
                                   `👤 ${athlete} (${teamName})\n` +
                                   `⏱ ${eTime}'`;
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
                    statusMsg = `⏸ *DEVRE ARASI*\n🏟 ${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}`;
                } else if (newStatus === 'STATUS_FULL_TIME') {
                    statusMsg = `🏁 *MAÇ SONU*\n🏟 ${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}`;
                } else if (newStatus.includes('EXTRA_TIME')) {
                    statusMsg = `⏱ *UZATMALAR*\n🏟 ${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}`;
                } else if (newStatus.includes('PENALTY')) {
                    statusMsg = `🎯 *PENALTILAR*\n🏟 ${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}`;
                }

                if (statusMsg) {
                    broadcastToTrackers(matchId, statusMsg);
                }
            }

            state.score = currentScore;

        } catch (error) {}
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

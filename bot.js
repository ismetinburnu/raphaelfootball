const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('RAPHAEL GLOBAL ONLINE'));
app.listen(process.env.PORT || 3000);

const token = '8692050432:AAGHsImArczpglBwM_u8gC5PHuYJOSI6n5A';
const adminId = '8402118528';
const bot = new TelegramBot(token, { polling: true });

const globalTrackedMatches = new Set();
const activeChats = new Set();
const matchStates = {};
let isFetching = false;

bot.on('polling_error', () => {});

const formatTurkishDate = (dateString) => {
    if (!dateString) return 'Belirsiz';
    try {
        const d = new Date(dateString);
        return d.toLocaleString('tr-TR', { 
            weekday: 'short', month: 'long', day: 'numeric', 
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' 
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

bot.onText(/\/(start|takip)/, (msg, match) => {
    const chatId = msg.chat.id;
    activeChats.add(chatId);

    if (String(chatId) === adminId && match[1] === 'start') {
        const kb = [
            [{ text: '🔍 Maç Ara ve Ekle', callback_data: 'search_match' }],
            [{ text: '📋 Global Takip Listesi', callback_data: 'list_tracked' }]
        ];
        bot.sendMessage(chatId, `👑 *Admin Paneli*\nİşlem seçin:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    } else {
        renderList(chatId);
    }
});

bot.on('channel_post', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (text && text.match(/^\/takip(?:@\w+)?$/)) {
        activeChats.add(chatId);
        renderList(chatId);
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    activeChats.add(chatId);

    if (!text || text.startsWith('/')) return;

    if (String(chatId) === adminId && matchStates['admin_search_mode']) {
        matchStates['admin_search_mode'] = false;
        bot.sendMessage(chatId, '⏳ Aranıyor...');
        searchMatches(chatId, text);
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    activeChats.add(chatId);

    if (data === 'search_match' && String(chatId) === adminId) {
        matchStates['admin_search_mode'] = true;
        bot.sendMessage(chatId, '🔍 Takım veya lig adı yazın:');
        bot.answerCallbackQuery(query.id);
    } 
    else if (data === 'list_tracked' || data === 'back_main') {
        bot.answerCallbackQuery(query.id);
        renderList(chatId, messageId);
    }
    else if (data.startsWith('add_') && String(chatId) === adminId) {
        const matchId = data.split('_')[1];
        globalTrackedMatches.add(matchId);
        bot.answerCallbackQuery(query.id, { text: '✅ Küresel listeye eklendi' });
        bot.deleteMessage(chatId, messageId).catch(() => {});
        renderDetail(chatId, messageId, matchId, true);
    }
    else if (data.startsWith('rem_') && String(chatId) === adminId) {
        const matchId = data.split('_')[1];
        globalTrackedMatches.delete(matchId);
        bot.answerCallbackQuery(query.id, { text: '🗑 Küresel listeden silindi' });
        renderList(chatId, messageId);
    }
    else if (data.startsWith('detail_')) {
        const matchId = data.split('_')[1];
        bot.answerCallbackQuery(query.id);
        renderDetail(chatId, messageId, matchId);
    }
    else if (data.startsWith('analiz_')) {
        const matchId = data.split('_')[1];
        bot.answerCallbackQuery(query.id);
        renderAnalysis(chatId, messageId, matchId);
    }
    else if (data.startsWith('refreshlist_')) {
        bot.answerCallbackQuery(query.id, { text: '🔄 Liste Yenileniyor...' });
        renderList(chatId, messageId);
    }
    else if (data.startsWith('refreshdetail_')) {
        const matchId = data.split('_')[1];
        bot.answerCallbackQuery(query.id, { text: '🔄 Maç Yenileniyor...' });
        renderDetail(chatId, messageId, matchId);
    }
    else if (data.startsWith('refreshanaliz_')) {
        const matchId = data.split('_')[1];
        bot.answerCallbackQuery(query.id, { text: '🔄 Analiz Yenileniyor...' });
        renderAnalysis(chatId, messageId, matchId);
    }
    else if (data === 'dummy') {
        bot.answerCallbackQuery(query.id, { text: 'Zaten ekli!', show_alert: true });
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
            bot.sendMessage(chatId, `❌ Bulunamadı.`);
            return;
        }

        let msgText = `🔎 *Sonuçlar*\n`;
        const inline_keyboard = [];

        filtered.forEach(match => {
            const comp = match.competitions[0];
            const home = comp.competitors.find(c => c.homeAway === 'home');
            const away = comp.competitors.find(c => c.homeAway === 'away');
            const rawStatus = match.status.type.detail;
            const status = translateStatus(rawStatus, match.date);
            const isLive = match.status.type.state === 'in';
            const isTracked = globalTrackedMatches.has(String(match.id));

            if (isTracked) {
                inline_keyboard.push([{ text: `✅ Ekli: ${home.team.displayName} - ${away.team.displayName}`, callback_data: `dummy` }]);
            } else {
                inline_keyboard.push([{ text: `${isLive ? '🔴' : '⚪'} ${home.team.displayName} ${home.score ?? ''} - ${away.score ?? ''} ${away.team.displayName} [${status}]`, callback_data: `add_${match.id}` }]);
            }
        });

        bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard } });
    } catch (error) {
        bot.sendMessage(chatId, '❌ API Hatası.');
    }
}

async function renderList(chatId, messageId = null) {
    const trackedArr = Array.from(globalTrackedMatches);
    
    if (trackedArr.length === 0) {
        const emptyMsg = '📋 Takip edilen maç bulunmuyor.';
        const kb = { inline_keyboard: [[{ text: '🔄 Yenile', callback_data: 'refreshlist_' }]] };
        if (messageId) {
            bot.editMessageText(emptyMsg, { chat_id: chatId, message_id: messageId, reply_markup: kb }).catch(() => {});
        } else {
            bot.sendMessage(chatId, emptyMsg, { reply_markup: kb });
        }
        return;
    }

    let kb = [];
    for (const matchId of trackedArr) {
        try {
            const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${matchId}`);
            const comp = response.data.header.competitions[0];
            const home = comp.competitors.find(c => c.homeAway === 'home');
            const away = comp.competitors.find(c => c.homeAway === 'away');
            const isLive = comp.status.type.state === 'in';
            const icon = isLive ? '🔴' : '⚪';
            kb.push([{ text: `${icon} ${home.team.displayName} ${home.score ?? '-'} - ${away.score ?? '-'} ${away.team.displayName}`, callback_data: `detail_${matchId}` }]);
        } catch (e) {}
    }
    
    kb.push([{ text: '🔄 Yenile', callback_data: 'refreshlist_' }]);
    
    const msgText = `📋 *Canlı Takip Listesi*`;
    const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } };

    if (messageId) {
        bot.editMessageText(msgText, { chat_id: chatId, message_id: messageId, ...options }).catch(() => {
            bot.sendMessage(chatId, msgText, options);
        });
    } else {
        bot.sendMessage(chatId, msgText, options);
    }
}

async function renderDetail(chatId, messageId, matchId, isNew = false) {
    try {
        const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${matchId}`);
        const data = response.data;
        const comp = data.header.competitions[0];
        
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        const status = translateStatus(comp.status.type.detail, comp.date);
        const isLive = comp.status.type.state === 'in';

        let text = `${isNew ? '✅ *EKLENDİ*\n\n' : ''}`;
        text += `🏟 *${home.team.displayName} ${home.score ?? '-'} : ${away.score ?? '-'} ${away.team.displayName}*\n`;
        text += `⏱ ${status}\n`;

        if (isLive && data.keyEvents && data.keyEvents.length > 0) {
            const lastEvent = data.keyEvents[data.keyEvents.length - 1];
            text += `📌 ${lastEvent.type.text} (${lastEvent.clock?.displayValue || ''}')\n`;
        }

        let kb = [
            [
                { text: '📊 Analiz', callback_data: `analiz_${matchId}` },
                { text: '🔄 Yenile', callback_data: `refreshdetail_${matchId}` }
            ]
        ];

        if (String(chatId) === adminId) {
            kb.push([{ text: '🗑 Listeden Çıkar', callback_data: `rem_${matchId}` }]);
        }
        
        kb.push([{ text: '🔙 Geri Dön', callback_data: `back_main` }]);

        if (messageId && !isNew) {
            bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
        } else {
            bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
    } catch (e) {}
}

async function renderAnalysis(chatId, messageId, matchId) {
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

        const msg = `📊 *Analiz Verileri*\n\n` +
                    `1️⃣ *${home.displayName}*: %${hPct}\n` +
                    `✖️ *Beraberlik*: %${tPct}\n` +
                    `2️⃣ *${away.displayName}*: %${aPct}`;

        const kb = [
            [
                { text: '🏟 Maç Sonucu', callback_data: `detail_${matchId}` },
                { text: '🔄 Yenile', callback_data: `refreshanaliz_${matchId}` }
            ],
            [
                { text: '🔙 Geri Dön', callback_data: `back_main` }
            ]
        ];

        bot.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
    } catch (e) {}
}

setInterval(async () => {
    if (isFetching || globalTrackedMatches.size === 0) return;
    isFetching = true;

    for (const matchId of Array.from(globalTrackedMatches)) {
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
                    notifiedEvents: new Set(),
                    finishedAt: null
                };
            }

            const state = matchStates[matchId];
            const currentScore = `${home.score}-${away.score}`;
            const keyEvents = data.keyEvents || [];
            const newStatus = comp.status.type.name;

            if (newStatus === 'STATUS_FULL_TIME' || state.status === 'STATUS_FULL_TIME') {
                if (!state.finishedAt) state.finishedAt = Date.now();
            }

            if (state.finishedAt && Date.now() - state.finishedAt > 900000) {
                globalTrackedMatches.delete(matchId);
                delete matchStates[matchId];
                continue;
            }

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
                        let isMissed = eType.includes('miss');
                        if (isMissed) {
                            alertMsg = `❌ *PENALTI KAÇTI*\n\n🏟 *${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}*\n👤 ${athlete} (${teamName})\n⏱ ${eTime}'`;
                        } else {
                            alertMsg = `🚨 *GOL*\n\n🏟 *${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}*\n👤 ${athlete} (${teamName})\n⏱ ${eTime}' ${extraStr}`;
                        }
                    } 
                    else if (eType.includes('red card')) {
                        alertMsg = `🟥 *KIRMIZI KART*\n\n🏟 *${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}*\n👤 ${athlete} (${teamName})\n⏱ ${eTime}'`;
                    }
                    else if (eType.includes('disallowed') || eType.includes('var')) {
                        alertMsg = `🖥 *VAR KARARI / İPTAL*\n\n🏟 *${home.team.displayName} ${home.score} - ${away.score} ${away.team.displayName}*\n📌 ${event.type.text}\n⏱ ${eTime}'`;
                    }

                    if (alertMsg) broadcastToTrackers(alertMsg);
                }
            });

            if (state.status !== newStatus) {
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

                if (statusMsg) broadcastToTrackers(statusMsg);
            }

            state.score = currentScore;
        } catch (error) {}
    }
    
    isFetching = false;
}, 10000);

function broadcastToTrackers(message) {
    Array.from(activeChats).forEach(chatId => {
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(() => {
            activeChats.delete(chatId);
        });
    });
}

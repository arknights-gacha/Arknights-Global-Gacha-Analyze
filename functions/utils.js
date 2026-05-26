const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatDateTime(timestamp) {
    const date = new Date(timestamp * 1000);
    const yr = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const da = String(date.getDate()).padStart(2, '0');
    const hr = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const se = String(date.getSeconds()).padStart(2, '0');
    return `${yr}/${mo}/${da} ${hr}:${mi}:${se}`;
}

async function getUid(yssid = '', yssidSig = '', server = 'jp') {
    const host = server === 'en' ? 'account.yo-star.com' : (server === 'kr' ? 'account.yostar.kr' : 'account.yostar.co.jp');
    const url = `https://${host}/api/user/game-list`;
    const CookieStr = `YSSID=${yssid}; YSSID.sig=${yssidSig}`;
    
    const langMap = { 'en': 'en', 'kr': 'kr', 'jp': 'ja' };
    const headers = { 'lang': langMap[server] || 'ja', 'Cookie': CookieStr };
    const response = await axios.get(url, { headers });
    
    const js = response.data;
    if (js.code !== 0) {
        throw new Error(`API code=${js.code}`);
    }
    
    const arkData = js.data.find(game => game.key === 'ark');
    if (!arkData || !arkData.playerInfo) {
        throw new Error(`Cannot find Arknights data or playerInfo`);
    }
    
    arkData.playerInfo.lastFetched = formatDateTime(Math.floor(Date.now() / 1000));
    arkData.playerInfo.ts = Math.floor(Date.now() / 1000);
    
    return [arkData.playerInfo.uid, arkData.playerInfo];
}

async function fetchGachaTypes(yssid, yssidSig, server = 'jp') {
    const host = server === 'en' ? 'account.yo-star.com' : (server === 'kr' ? 'account.yostar.kr' : 'account.yostar.co.jp');
    const url = `https://${host}/api/game/gacha-types?key=ark`;
    const CookieStr = `YSSID=${yssid}; YSSID.sig=${yssidSig}`;
    
    const langMap = { 'en': 'en', 'kr': 'kr', 'jp': 'ja' };
    const headers = { 'lang': langMap[server] || 'ja', 'Cookie': CookieStr };
    const response = await axios.get(url, { headers });
    
    if (response.data.code !== 0) {
        throw new Error(`API code=${response.data.code}`);
    }
    return response.data.data.types;
}

async function fetchVisitLogPage(type, index, yssid, yssidSig, server = 'jp') {
    const host = server === 'en' ? 'account.yo-star.com' : (server === 'kr' ? 'account.yostar.kr' : 'account.yostar.co.jp');
    const typeEncoded = encodeURIComponent(type);
    const url = `https://${host}/api/game/gachas?key=ark&index=${index}&size=100&type=${typeEncoded}`;
    const CookieStr = `YSSID=${yssid}; YSSID.sig=${yssidSig}`;
    
    const langMap = { 'en': 'en', 'kr': 'kr', 'jp': 'ja' };
    const headers = { 'lang': langMap[server] || 'ja', 'Cookie': CookieStr };
    const response = await axios.get(url, { headers });
    
    const js = response.data;
    if (js.code !== 0) {
        throw new Error(`API code=${js.code}`);
    }
    
    if (js.data && js.data.rows) {
        for (let item of js.data.rows) {
            item.time = item.atStr;
        }
    }
    
    return js.data;
}

async function fetchAllLogsSlowly(uid, yssid = '', yssidSig = '', server = 'jp') {
    let allLogs = [];
    const types = await fetchGachaTypes(yssid, yssidSig, server);
    
    for (let type of types) {
        let index = 1;
        let fetchedCountForType = 0;
        
        while (true) {
            const data = await fetchVisitLogPage(type, index, yssid, yssidSig, server);
            const rows = data.rows || [];
            
            if (rows.length === 0) {
                break;
            }
            
            allLogs = allLogs.concat(rows);
            fetchedCountForType += rows.length;
            
            if (fetchedCountForType >= data.count) {
                break;
            }
            
            index += 1;
            await sleep(200);
        }
        await sleep(200);
    }
    
    // Sort allLogs by `at` timestamp descending (newest to oldest) to preserve order for merge
    allLogs.sort((a, b) => b.at - a.at);
    
    return allLogs;
}

function mergeLogs(records, previousRecords) {
    let cursorNow = 0;
    let cursorPrev = 0;
    
    while (cursorNow < records.length && cursorPrev < previousRecords.length) {
        let cursorNowBak = cursorNow;
        let cursorPrevBak = cursorPrev;
        
        let clusterNow = [records[cursorNow]];
        let clusterPrev = [previousRecords[cursorPrev]];
        
        cursorNow += 1;
        cursorPrev += 1;
        
        while (cursorNow < records.length && records[cursorNow].at === clusterNow[0].at) {
            clusterNow.push(records[cursorNow]);
            cursorNow += 1;
        }
        
        while (cursorPrev < previousRecords.length && previousRecords[cursorPrev].at === clusterPrev[0].at) {
            clusterPrev.push(previousRecords[cursorPrev]);
            cursorPrev += 1;
        }
        
        if (clusterNow.length === 0 || clusterPrev.length === 0) {
            break;
        } else if (clusterNow[0].at === clusterPrev[0].at) {
            if (clusterNow.length > 10 || clusterPrev.length > 10) {
                console.warn(`Warning: too many records in the same time cluster, ${clusterNow.length} vs ${clusterPrev.length}, please check manually.`);
            }
            if (clusterNow.length === clusterPrev.length) {
                for (let i = 0; i < clusterPrev.length; i++) {
                    if (previousRecords[cursorPrevBak].charName === clusterNow[i].charName) {
                        previousRecords.splice(cursorPrevBak, 1);
                    } else {
                        console.warn(`Warning: oprator name not matching, ${previousRecords[cursorPrevBak].charName} vs ${clusterNow[i].charName}`);
                        previousRecords.splice(cursorPrevBak, 1);
                    }
                }
                cursorPrev = cursorPrevBak;
            } else {
                console.warn(`Warning: records length not matching, ${clusterNow.length} vs ${clusterPrev.length}, keep the longer one`);
                if (clusterNow.length > clusterPrev.length) {
                    for (let i = 0; i < clusterPrev.length; i++) {
                        previousRecords.splice(cursorPrevBak, 1);
                        cursorPrev = cursorPrevBak;
                    }
                } else {
                    for (let i = 0; i < clusterNow.length; i++) {
                        records.splice(cursorNowBak, 1);
                        cursorNow = cursorNowBak;
                    }
                }
                break;
            }
        } else {
            cursorPrev = cursorPrevBak;
        }
    }
    return records.concat(previousRecords);
}

function classifyPool(poolId) {
    if (!poolId) return '其他尋訪';
    
    const categories = {
        '所有卡池': [],
        '限定尋訪': ['LIMITED', 'LINKAGE'],
        '標準尋訪': ['NORM', 'SINGLE', 'DOUBLE', 'SPECIAL'],
        '中堅尋訪': ['CLASSIC', 'FESCLASSIC', 'CLASSIC_DOUBLE'],
        '其他尋訪': ['ATTAIN_CLASSIC', 'CLASSIC_ATTAIN', 'ATTAIN', 'BOOT'],
    };
    
    for (let cat of ['其他尋訪', '中堅尋訪', '標準尋訪', '限定尋訪']) {
        for (let pre of categories[cat]) {
            if (poolId.toUpperCase().startsWith(pre)) {
                return cat;
            }
        }
    }
    return '其他尋訪';
}

function analyzeLogs(logs) {
    let logsCopy = JSON.parse(JSON.stringify(logs));
    logsCopy.reverse(); // Now from newest to oldest
    
    let n = logsCopy.length;
    let starcounts = {
        '所有卡池': { '5': 0, '4': 0, '3': 0, '2': 0 },
        '限定尋訪': { '5': 0, '4': 0, '3': 0, '2': 0 },
        '標準尋訪': { '5': 0, '4': 0, '3': 0, '2': 0 },
        '中堅尋訪': { '5': 0, '4': 0, '3': 0, '2': 0 },
        '其他尋訪': { '5': 0, '4': 0, '3': 0, '2': 0 }
    };
    let starcountsPool = {};
    let countAcc = { '標準尋訪': 0, '中堅尋訪': 0 };
    
    let rarityMap = { '3星': '2', '4星': '3', '5星': '4', '6星': '5' };
    
    for (let i = 0; i < n; i++) {
        let item = logsCopy[i];
        let rarity = rarityMap[item.star] || '2';
        item.rarity = rarity;
        
        starcounts['所有卡池'][rarity]++;
        let pool = (item.poolId || '').toUpperCase();
        let category = classifyPool(pool);
        starcounts[category][rarity]++;
        
        if (!starcountsPool[pool]) {
            starcountsPool[pool] = { '5': 0, '4': 0, '3': 0, '2': 0 };
        }
        starcountsPool[pool][rarity]++;
        
        if (category === "標準尋訪") {
            countAcc['標準尋訪']++;
            if (rarity === "5") {
                logsCopy[i].interval = countAcc['標準尋訪'];
                countAcc['標準尋訪'] = 0;
            }
        } else if (category === "中堅尋訪") {
            countAcc['中堅尋訪']++;
            if (rarity === "5") {
                logsCopy[i].interval = countAcc['中堅尋訪'];
                countAcc['中堅尋訪'] = 0;
            }
        } else {
            if (countAcc[pool] === undefined) {
                countAcc[pool] = 0;
            }
            countAcc[pool]++;
            if (rarity === "5") {
                logsCopy[i].interval = countAcc[pool];
                countAcc[pool] = 0;
            }
        }
    }
    
    logsCopy.reverse(); // Back to oldest to newest
    let lastPullItem = logsCopy[0] || {};
    let lastPullName = lastPullItem.poolName ? lastPullItem.poolName : lastPullItem.poolId;
    let lastPullId = lastPullItem.poolId || '';
    let category = classifyPool(lastPullId);
    let accumulation = countAcc[category] !== undefined ? countAcc[category] : (countAcc[lastPullId] !== undefined ? countAcc[lastPullId] : 0);
    
    return {
        logs: logsCopy,
        starcounts,
        starcountsPool,
        lastPullName,
        lastPullId,
        accumulation,
        countAcc: countAcc,
        totalPulls: logsCopy.length
    };
}

module.exports = {
    getUid,
    fetchGachaTypes,
    fetchVisitLogPage,
    fetchAllLogsSlowly,
    mergeLogs,
    analyzeLogs
};

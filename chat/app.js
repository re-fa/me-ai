// ============================================
// محادثة P2P — WebRTC بدون خادم مع تبادل يدوي
// ============================================

// ---------- الإعدادات ----------
const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    iceCandidatePoolSize: 10
};

const ICE_GATHERING_TIMEOUT_MS = 3000;
const CONNECTION_TIMEOUT_MS = 30000;

// ---------- الحالة ----------
let pc = null;
let dataChannel = null;
let iceManager = null;
let connectionTimer = null;
let currentMode = 'host'; // 'host' | 'join'
let isInitializing = false;

// ---------- الوصول للعناصر ----------
const $ = (id) => document.getElementById(id);

const dom = {
    // الحالة
    statusBadge: $('connectionStatus'),
    statusText: $('statusText'),
    // التبويبات
    modeTabs: document.querySelectorAll('.mode-tab'),
    hostFlow: $('hostFlow'),
    joinFlow: $('joinFlow'),
    // المضيف
    offerOutput: $('offerOutput'),
    copyOfferBtn: $('copyOfferBtn'),
    hostLoading: $('hostLoading'),
    hostAnswerSection: $('hostAnswerSection'),
    answerInput: $('answerInput'),
    completeConnectionBtn: $('completeConnectionBtn'),
    // المنضم
    offerInput: $('offerInput'),
    generateAnswerBtn: $('generateAnswerBtn'),
    joinAnswerSection: $('joinAnswerSection'),
    answerOutput: $('answerOutput'),
    copyAnswerBtn: $('copyAnswerBtn'),
    joinLoading: $('joinLoading'),
    // الخطأ
    errorBanner: $('errorBanner'),
    errorMessage: $('errorMessage'),
    retryBtn: $('retryBtn'),
    // المحادثة
    setupPanel: $('setupPanel'),
    chatPanel: $('chatPanel'),
    chatMessages: $('chatMessages'),
    messageInput: $('messageInput'),
    sendBtn: $('sendBtn'),
    disconnectBtn: $('disconnectBtn'),
    // الإشعار
    toast: $('toast')
};

// ---------- أدوات مساعدة ----------

/** ترميز آمن Base64 مع دعم Unicode */
function encodeTicket(obj) {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)));
}

/** فك ترميز آمن Base64 مع دعم Unicode */
function decodeTicket(str) {
    const json = decodeURIComponent(escape(atob(str)));
    return JSON.parse(json);
}

/** إظهار إشعار عائم */
let toastTimer = null;
function showToast(message, duration = 2500) {
    clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.remove('hidden');
    requestAnimationFrame(() => dom.toast.classList.add('show'));
    toastTimer = setTimeout(() => {
        dom.toast.classList.remove('show');
        setTimeout(() => dom.toast.classList.add('hidden'), 300);
    }, duration);
}

/** تحديث شارة الحالة */
function setStatus(state, text) {
    dom.statusBadge.className = 'status-badge';
    if (state === 'connected') dom.statusBadge.classList.add('status-connected');
    else if (state === 'connecting') dom.statusBadge.classList.add('status-connecting');
    else if (state === 'error') dom.statusBadge.classList.add('status-error');
    dom.statusText.textContent = text;
}

/** عرض شريط الخطأ */
function showError(message) {
    dom.errorMessage.textContent = message;
    dom.errorBanner.classList.remove('hidden');
    setStatus('error', 'خطأ');
}

function hideError() {
    dom.errorBanner.classList.add('hidden');
}

/** نسخ إلى الحافظة مع تغذية راجعة */
async function copyFrom(element, btnElement) {
    const text = element.value;
    if (!text) return;
    const original = btnElement.innerHTML;
    try {
        await navigator.clipboard.writeText(text);
        btnElement.innerHTML = '<span>✓</span> تم النسخ';
        setTimeout(() => { btnElement.innerHTML = original; }, 1500);
    } catch (e) {
        // طريقة بديلة
        element.select();
        element.setSelectionRange(0, 99999);
        try {
            document.execCommand('copy');
            btnElement.innerHTML = '<span>✓</span> تم النسخ';
            setTimeout(() => { btnElement.innerHTML = original; }, 1500);
        } catch (err) {
            showToast('فشل النسخ، انسخ يدوياً');
        }
    }
}

/** انتظار اكتمال جمع ICE مع مهلة زمنية */
function waitForIceGathering(peerConnection, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
    return new Promise((resolve) => {
        if (peerConnection.iceGatheringState === 'complete') {
            resolve();
            return;
        }

        let resolved = false;

        const finish = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            peerConnection.removeEventListener('icegatheringstatechange', checkState);
            resolve();
        };

        const checkState = () => {
            if (peerConnection.iceGatheringState === 'complete') {
                finish();
            }
        };

        const timeout = setTimeout(finish, timeoutMs);

        peerConnection.addEventListener('icegatheringstatechange', checkState);
    });
}

/** مدير مرشحي ICE مع تخزين مؤقت */
function createIceManager(peerConnection) {
    const pending = [];

    return {
        async add(candidate) {
            if (!candidate) return;
            if (!peerConnection.remoteDescription) {
                pending.push(candidate);
                return;
            }
            try {
                await peerConnection.addIceCandidate(candidate);
            } catch (e) {
                console.warn('فشل إضافة مرشح ICE:', e);
            }
        },
        async flush() {
            for (const candidate of pending) {
                try {
                    await peerConnection.addIceCandidate(candidate);
                } catch (e) {
                    console.warn('فشل تفريغ مرشح ICE:', e);
                }
            }
            pending.length = 0;
        }
    };
}

/** بدء مؤقت مهلة الاتصال */
function startConnectionTimer() {
    clearConnectionTimer();
    connectionTimer = setTimeout(() => {
        if (pc && pc.connectionState !== 'connected') {
            showError('انتهت مهلة الاتصال. تحقق من الرموز أو أعد المحاولة.');
        }
    }, CONNECTION_TIMEOUT_MS);
}

function clearConnectionTimer() {
    if (connectionTimer) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
    }
}

/** تنظيف الاتصال وإعادة الحالة */
function cleanupConnection() {
    clearConnectionTimer();
    if (dataChannel) {
        try { dataChannel.close(); } catch (e) {}
        dataChannel = null;
    }
    if (pc) {
        try { pc.close(); } catch (e) {}
        pc = null;
    }
    iceManager = null;
}

// ---------- إعداد قناة البيانات ----------

function setupDataChannel(channel) {
    dataChannel = channel;

    channel.onopen = () => {
        clearConnectionTimer();
        setStatus('connected', 'متصل');
        dom.setupPanel.classList.add('hidden');
        dom.chatPanel.classList.remove('hidden');
        dom.messageInput.disabled = false;
        dom.sendBtn.disabled = false;
        dom.messageInput.focus();
        showToast('🟢 تم الاتصال مباشرة');
        appendSystemMessage('تم الاتصال بالجهاز الآخر');
    };

    channel.onmessage = (event) => {
        appendMessage(event.data, 'received');
    };

    channel.onclose = () => {
        setStatus('idle', 'غير متصل');
        dom.chatPanel.classList.add('hidden');
        dom.setupPanel.classList.remove('hidden');
        dom.messageInput.disabled = true;
        dom.sendBtn.disabled = true;
        showToast('انقطع الاتصال');
    };

    channel.onerror = (error) => {
        console.error('خطأ في قناة البيانات:', error);
        showError('حدث خطأ في قناة البيانات');
    };
}

// ---------- إعداد اتصال النظير ----------

function createPeerConnection() {
    const peer = new RTCPeerConnection(RTC_CONFIG);
    iceManager = createIceManager(peer);

    peer.onicecandidate = () => {
        // في التبادل اليدوي، المرشحون مضمنون في SDP
    };

    peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        if (state === 'connected') {
            setStatus('connected', 'متصل');
            clearConnectionTimer();
        } else if (state === 'connecting') {
            setStatus('connecting', 'جاري الاتصال...');
        } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
            if (state !== 'closed') {
                setStatus('error', 'فشل الاتصال');
            }
            clearConnectionTimer();
        }
    };

    peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'failed') {
            showError('فشل الاتصال عبر الشبكة. قد تحتاج شبكتك إلى خادم TURN.');
        }
    };

    return peer;
}

// ---------- مسار المضيف ----------

async function initHostFlow() {
    if (isInitializing) return;
    isInitializing = true;

    cleanupConnection();
    hideError();
    currentMode = 'host';

    // إعادة تعيين الواجهة
    dom.offerOutput.value = '';
    dom.copyOfferBtn.disabled = true;
    dom.hostLoading.classList.remove('hidden');
    dom.hostAnswerSection.classList.add('step-locked');
    dom.answerInput.value = '';
    dom.completeConnectionBtn.disabled = true;
    dom.completeConnectionBtn.innerHTML = '<span>🔗</span> إكمال الاتصال';

    setStatus('connecting', 'جاري التجهيز...');

    try {
        pc = createPeerConnection();
        dataChannel = pc.createDataChannel('chat', { ordered: true });
        setupDataChannel(dataChannel);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await waitForIceGathering(pc);

        const ticket = encodeTicket(pc.localDescription);
        dom.offerOutput.value = ticket;
        dom.copyOfferBtn.disabled = false;
        dom.hostLoading.classList.add('hidden');
        dom.hostAnswerSection.classList.remove('step-locked');
        dom.completeConnectionBtn.disabled = false;
        setStatus('idle', 'بانتظار الرد');
        startConnectionTimer();
    } catch (err) {
        console.error('فشل إنشاء الغرفة:', err);
        showError('فشل إنشاء الغرفة. حاول مرة أخرى.');
        dom.hostLoading.classList.add('hidden');
    } finally {
        isInitializing = false;
    }
}

async function completeHostConnection() {
    const raw = dom.answerInput.value.trim();
    if (!raw) {
        showToast('الرجاء لصق رمز الإجابة أولاً');
        return;
    }
    if (!pc) {
        showError('لا يوجد اتصال نشط. أعد إنشاء الغرفة.');
        return;
    }

    dom.completeConnectionBtn.disabled = true;
    dom.completeConnectionBtn.innerHTML = '<div class="spinner spinner-sm"></div> جاري الاتصال...';

    try {
        const answer = decodeTicket(raw);
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await iceManager.flush();
        setStatus('connecting', 'جاري الاتصال...');
        startConnectionTimer();
    } catch (err) {
        console.error('فشل تطبيق الإجابة:', err);
        showError('رمز الإجابة غير صحيح أو تالف.');
        dom.completeConnectionBtn.disabled = false;
        dom.completeConnectionBtn.innerHTML = '<span>🔗</span> إكمال الاتصال';
    }
}

// ---------- مسار المنضم ----------

async function generateJoinAnswer() {
    const raw = dom.offerInput.value.trim();
    if (!raw) {
        showToast('الرجاء لصق رمز الدعوة أولاً');
        return;
    }

    hideError();
    dom.generateAnswerBtn.disabled = true;
    dom.generateAnswerBtn.innerHTML = '<div class="spinner spinner-sm"></div> جاري التجهيز...';

    try {
        const offer = decodeTicket(raw);
        cleanupConnection();
        currentMode = 'join';

        pc = createPeerConnection();

        pc.ondatachannel = (event) => {
            setupDataChannel(event.channel);
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await iceManager.flush();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await waitForIceGathering(pc);

        const ticket = encodeTicket(pc.localDescription);
        dom.answerOutput.value = ticket;
        dom.copyAnswerBtn.disabled = false;
        dom.joinAnswerSection.classList.remove('step-locked');
        setStatus('connecting', 'جاري الاتصال...');
        startConnectionTimer();

        dom.generateAnswerBtn.disabled = false;
        dom.generateAnswerBtn.innerHTML = '<span>⚙️</span> توليد رمز الإجابة';
    } catch (err) {
        console.error('فشل الانضمام:', err);
        showError('رمز الدعوة غير صحيح أو تالف.');
        dom.generateAnswerBtn.disabled = false;
        dom.generateAnswerBtn.innerHTML = '<span>⚙️</span> توليد رمز الإجابة';
    }
}

// ---------- المحادثة ----------

function appendMessage(text, type) {
    const row = document.createElement('div');
    row.className = `msg-row msg-${type}`;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = new Date().toLocaleTimeString('ar-EG', {
        hour: '2-digit',
        minute: '2-digit'
    });

    bubble.appendChild(time);
    row.appendChild(bubble);
    dom.chatMessages.appendChild(row);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function appendSystemMessage(text) {
    const row = document.createElement('div');
    row.className = 'msg-row';
    row.style.justifyContent = 'center';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.style.background = 'transparent';
    bubble.style.color = 'var(--text-muted)';
    bubble.style.fontSize = '12px';
    bubble.style.textAlign = 'center';
    bubble.style.maxWidth = '100%';
    bubble.textContent = text;

    row.appendChild(bubble);
    dom.chatMessages.appendChild(row);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function sendMessage() {
    const text = dom.messageInput.value.trim();
    if (!text) return;
    if (!dataChannel || dataChannel.readyState !== 'open') {
        showToast('القناة غير جاهزة');
        return;
    }
    dataChannel.send(text);
    appendMessage(text, 'sent');
    dom.messageInput.value = '';
    dom.messageInput.focus();
}

function disconnect() {
    cleanupConnection();
    dom.chatPanel.classList.add('hidden');
    dom.setupPanel.classList.remove('hidden');
    dom.chatMessages.innerHTML = '';
    setStatus('idle', 'جاهز');
    dom.messageInput.disabled = true;
    dom.sendBtn.disabled = true;

    // إعادة تعيين واجهة المضيف
    dom.offerOutput.value = '';
    dom.copyOfferBtn.disabled = true;
    dom.hostLoading.classList.remove('hidden');
    dom.hostAnswerSection.classList.add('step-locked');
    dom.answerInput.value = '';
    dom.completeConnectionBtn.disabled = true;
    dom.completeConnectionBtn.innerHTML = '<span>🔗</span> إكمال الاتصال';

    // إعادة تعيين واجهة المنضم
    dom.answerOutput.value = '';
    dom.copyAnswerBtn.disabled = true;
    dom.joinAnswerSection.classList.add('step-locked');
    dom.generateAnswerBtn.disabled = false;
    dom.generateAnswerBtn.innerHTML = '<span>⚙️</span> توليد رمز الإجابة';

    showToast('تم قطع الاتصال');
}

// ---------- ربط الأحداث ----------

function bindEvents() {
    // تبديل الوضع
    dom.modeTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            dom.modeTabs.forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');

            if (tab.dataset.mode === 'host') {
                dom.hostFlow.classList.remove('hidden');
                dom.joinFlow.classList.add('hidden');
                initHostFlow();
            } else {
                dom.hostFlow.classList.add('hidden');
                dom.joinFlow.classList.remove('hidden');
                cleanupConnection();
                hideError();
                setStatus('idle', 'جاهز');
            }
        });
    });

    // أزرار المضيف
    dom.copyOfferBtn.addEventListener('click', () => copyFrom(dom.offerOutput, dom.copyOfferBtn));
    dom.completeConnectionBtn.addEventListener('click', completeHostConnection);

    // أزرار المنضم
    dom.generateAnswerBtn.addEventListener('click', generateJoinAnswer);
    dom.copyAnswerBtn.addEventListener('click', () => copyFrom(dom.answerOutput, dom.copyAnswerBtn));

    // المحادثة
    dom.sendBtn.addEventListener('click', sendMessage);
    dom.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    dom.disconnectBtn.addEventListener('click', disconnect);

    // زر إعادة المحاولة
    dom.retryBtn.addEventListener('click', () => {
        hideError();
        if (currentMode === 'host') initHostFlow();
        else generateJoinAnswer();
    });

    // تنظيف عند إغلاق الصفحة
    window.addEventListener('beforeunload', () => {
        cleanupConnection();
    });
}

// ---------- نقطة الانطلاق ----------

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    initHostFlow();
});

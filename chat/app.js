// ============================================
// محادثة P2P — WebRTC + QR + مكالمات صوتية/مرئية
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
let currentMode = 'host';
let isInitializing = false;

// وسائط
let localStream = null;
let remoteStream = null;
let isVideoCallActive = false;
let isAudioCallActive = false;

// QR
let qrScanInterval = null;
let qrScanStream = null;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

const dom = {
    statusBadge: $('connectionStatus'),
    statusText: $('statusText'),
    modeTabs: document.querySelectorAll('.mode-tab'),
    hostFlow: $('hostFlow'),
    joinFlow: $('joinFlow'),
    offerOutput: $('offerOutput'),
    copyOfferBtn: $('copyOfferBtn'),
    showQrOfferBtn: $('showQrOfferBtn'),
    qrOfferBox: $('qrOfferBox'),
    offerQrCanvas: $('offerQrCanvas'),
    downloadQrOfferBtn: $('downloadQrOfferBtn'),
    closeQrOfferBtn: $('closeQrOfferBtn'),
    hostLoading: $('hostLoading'),
    hostAnswerSection: $('hostAnswerSection'),
    answerInput: $('answerInput'),
    completeConnectionBtn: $('completeConnectionBtn'),
    offerInput: $('offerInput'),
    generateAnswerBtn: $('generateAnswerBtn'),
    scanQrBtn: $('scanQrBtn'),
    qrScanBox: $('qrScanBox'),
    qrScanVideo: $('qrScanVideo'),
    stopScanBtn: $('stopScanBtn'),
    joinAnswerSection: $('joinAnswerSection'),
    answerOutput: $('answerOutput'),
    copyAnswerBtn: $('copyAnswerBtn'),
    showQrAnswerBtn: $('showQrAnswerBtn'),
    qrAnswerBox: $('qrAnswerBox'),
    answerQrCanvas: $('answerQrCanvas'),
    downloadQrAnswerBtn: $('downloadQrAnswerBtn'),
    closeQrAnswerBtn: $('closeQrAnswerBtn'),
    errorBanner: $('errorBanner'),
    errorMessage: $('errorMessage'),
    retryBtn: $('retryBtn'),
    setupPanel: $('setupPanel'),
    chatPanel: $('chatPanel'),
    videoArea: $('videoArea'),
    remoteVideo: $('remoteVideo'),
    localVideo: $('localVideo'),
    hangupVideoBtn: $('hangupVideoBtn'),
    chatMessages: $('chatMessages'),
    messageInput: $('messageInput'),
    sendBtn: $('sendBtn'),
    toggleAudioBtn: $('toggleAudioBtn'),
    toggleVideoBtn: $('toggleVideoBtn'),
    disconnectBtn: $('disconnectBtn'),
    toast: $('toast')
};

// ---------- أدوات ----------

function encodeTicket(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

function decodeTicket(str) {
    return JSON.parse(decodeURIComponent(escape(atob(str))));
}

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

function setStatus(state, text) {
    dom.statusBadge.className = 'status-badge';
    if (state === 'connected') dom.statusBadge.classList.add('status-connected');
    else if (state === 'connecting') dom.statusBadge.classList.add('status-connecting');
    else if (state === 'error') dom.statusBadge.classList.add('status-error');
    dom.statusText.textContent = text;
}

function showError(message) {
    dom.errorMessage.textContent = message;
    dom.errorBanner.classList.remove('hidden');
    setStatus('error', 'خطأ');
}

function hideError() {
    dom.errorBanner.classList.add('hidden');
}

async function copyFrom(element, btnElement) {
    const text = element.value;
    if (!text) return;
    const original = btnElement.innerHTML;
    try {
        await navigator.clipboard.writeText(text);
        btnElement.innerHTML = '✓ تم النسخ';
    } catch {
        element.select();
        document.execCommand('copy');
        btnElement.innerHTML = '✓ تم النسخ';
    }
    setTimeout(() => { btnElement.innerHTML = original; }, 1500);
}

function waitForIceGathering(peerConnection, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
    return new Promise((resolve) => {
        if (peerConnection.iceGatheringState === 'complete') { resolve(); return; }
        let resolved = false;
        const finish = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            peerConnection.removeEventListener('icegatheringstatechange', checkState);
            resolve();
        };
        const checkState = () => {
            if (peerConnection.iceGatheringState === 'complete') finish();
        };
        const timeout = setTimeout(finish, timeoutMs);
        peerConnection.addEventListener('icegatheringstatechange', checkState);
    });
}

function createIceManager(peerConnection) {
    const pending = [];
    return {
        async add(candidate) {
            if (!candidate) return;
            if (!peerConnection.remoteDescription) { pending.push(candidate); return; }
            try { await peerConnection.addIceCandidate(candidate); } catch (e) { console.warn(e); }
        },
        async flush() {
            for (const c of pending) {
                try { await peerConnection.addIceCandidate(c); } catch (e) { console.warn(e); }
            }
            pending.length = 0;
        }
    };
}

function startConnectionTimer() {
    clearConnectionTimer();
    connectionTimer = setTimeout(() => {
        if (pc && pc.connectionState !== 'connected') {
            showError('انتهت مهلة الاتصال. تحقق من الرموز أو أعد المحاولة.');
        }
    }, CONNECTION_TIMEOUT_MS);
}

function clearConnectionTimer() {
    if (connectionTimer) { clearTimeout(connectionTimer); connectionTimer = null; }
}

function cleanupConnection() {
    clearConnectionTimer();
    stopQrScan();
    if (dataChannel) { try { dataChannel.close(); } catch (e) {} dataChannel = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    iceManager = null;
    stopMedia();
}

function stopMedia() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    remoteStream = null;
    isVideoCallActive = false;
    isAudioCallActive = false;
    dom.videoArea.classList.add('hidden');
    dom.toggleAudioBtn.textContent = '📞';
    dom.toggleVideoBtn.textContent = '🎥';
}

// ---------- QR Code ----------

function generateQrOnCanvas(canvas, text, size = 256) {
    if (typeof QRCode === 'undefined') {
        // fallback: استخدام مكتبة qr الخفيفة عبر CDN
        showToast('مكتبة QR غير محملة');
        return false;
    }
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    QRCode.toCanvas(canvas, text, {
        width: size,
        margin: 2,
        color: { dark: '#0a0f1a', light: '#ffffff' }
    }, (err) => {
        if (err) console.error(err);
    });
    return true;
}

function downloadQrCanvas(canvas, filename = 'qr-code.png') {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

async function startQrScan() {
    try {
        qrScanStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
        });
        dom.qrScanVideo.srcObject = qrScanStream;
        await dom.qrScanVideo.play();
        dom.qrScanBox.classList.remove('hidden');

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        qrScanInterval = setInterval(() => {
            if (dom.qrScanVideo.readyState !== dom.qrScanVideo.HAVE_ENOUGH_DATA) return;
            canvas.width = dom.qrScanVideo.videoWidth;
            canvas.height = dom.qrScanVideo.videoHeight;
            ctx.drawImage(dom.qrScanVideo, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            if (typeof jsQR === 'undefined') return;
            const code = jsQR(imageData.data, canvas.width, canvas.height);
            if (code) {
                dom.offerInput.value = code.data;
                stopQrScan();
                showToast('✅ تم قراءة الرمز');
            }
        }, 300);
    } catch (err) {
        showToast('لا يمكن الوصول للكاميرا');
    }
}

function stopQrScan() {
    if (qrScanInterval) { clearInterval(qrScanInterval); qrScanInterval = null; }
    if (qrScanStream) {
        qrScanStream.getTracks().forEach(t => t.stop());
        qrScanStream = null;
    }
    dom.qrScanBox.classList.add('hidden');
    dom.qrScanVideo.srcObject = null;
}

// ---------- Media (Audio/Video) ----------

async function getLocalMedia(withVideo = false) {
    const constraints = {
        audio: true,
        video: withVideo ? { facingMode: 'user' } : false
    };
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        return stream;
    } catch (err) {
        console.error('getUserMedia failed:', err);
        showToast('لا يمكن الوصول للكاميرا/الميكروفون');
        return null;
    }
}

async function startCall(withVideo = false) {
    if (!pc || pc.connectionState !== 'connected') {
        showToast('يجب أن يكون الاتصال مكتملاً أولاً');
        return;
    }

    localStream = await getLocalMedia(withVideo);
    if (!localStream) return;

    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    if (withVideo) {
        dom.localVideo.srcObject = localStream;
        dom.videoArea.classList.remove('hidden');
        isVideoCallActive = true;
        dom.toggleVideoBtn.textContent = '📵';
    } else {
        isAudioCallActive = true;
        dom.toggleAudioBtn.textContent = '📵';
    }

    // إعادة التفاوض
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);
        const ticket = encodeTicket(pc.localDescription);
        dataChannel.send(JSON.stringify({ type: 'renegotiate', sdp: ticket }));
    } catch (err) {
        console.error('Renegotiation failed:', err);
    }
}

async function handleRenegotiation(sdpTicket) {
    try {
        const desc = decodeTicket(sdpTicket);
        await pc.setRemoteDescription(new RTCSessionDescription(desc));
        await iceManager.flush();

        if (localStream) {
            // نحن الطرف الذي يبدأ المكالمة، لا حاجة لعرض الفيديو البعيد هنا
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc);
        const ticket = encodeTicket(pc.localDescription);
        dataChannel.send(JSON.stringify({ type: 'renegotiate-answer', sdp: ticket }));
    } catch (err) {
        console.error('Handle renegotiation failed:', err);
    }
}

function handleRemoteTrack(event) {
    remoteStream = event.streams[0];
    if (remoteStream) {
        dom.remoteVideo.srcObject = remoteStream;
        dom.videoArea.classList.remove('hidden');
        isVideoCallActive = true;
        isAudioCallActive = true;
    }
}

function hangupMedia() {
    stopMedia();
    if (pc) {
        pc.getSenders().forEach(sender => {
            if (sender.track) {
                try { pc.removeTrack(sender); } catch (e) {}
            }
        });
    }
}

// ---------- Data Channel ----------

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
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'renegotiate') {
                handleRenegotiation(msg.sdp);
                return;
            }
            if (msg.type === 'renegotiate-answer') {
                const desc = decodeTicket(msg.sdp);
                pc.setRemoteDescription(new RTCSessionDescription(desc)).then(() => iceManager.flush());
                return;
            }
        } catch (e) {
            // رسالة نصية عادية
        }
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

    channel.onerror = (err) => {
        console.error('DataChannel error:', err);
        showError('حدث خطأ في قناة البيانات');
    };
}

// ---------- Peer Connection ----------

function createPeerConnection() {
    const peer = new RTCPeerConnection(RTC_CONFIG);
    iceManager = createIceManager(peer);

    peer.onicecandidate = async (event) => {
        if (event.candidate && iceManager) {
            await iceManager.add(event.candidate);
        }
    };

    peer.ontrack = handleRemoteTrack;

    peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        if (state === 'connected') { setStatus('connected', 'متصل'); clearConnectionTimer(); }
        else if (state === 'connecting') { setStatus('connecting', 'جاري الاتصال...'); }
        else if (state === 'failed' || state === 'disconnected') {
            setStatus('error', 'فشل الاتصال');
            clearConnectionTimer();
        }
    };

    peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'failed') {
            showError('فشل الاتصال عبر الشبكة. قد تحتاج شبكتك إلى TURN.');
        }
    };

    return peer;
}

// ---------- Host Flow ----------

async function initHostFlow() {
    if (isInitializing) return;
    isInitializing = true;

    cleanupConnection();
    hideError();
    currentMode = 'host';

    dom.offerOutput.value = '';
    dom.copyOfferBtn.disabled = true;
    dom.showQrOfferBtn.disabled = true;
    dom.qrOfferBox.classList.add('hidden');
    dom.hostLoading.classList.remove('hidden');
    dom.hostAnswerSection.classList.add('step-locked');
    dom.answerInput.value = '';
    dom.completeConnectionBtn.disabled = true;

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
        dom.showQrOfferBtn.disabled = false;
        dom.hostLoading.classList.add('hidden');
        dom.hostAnswerSection.classList.remove('step-locked');
        dom.completeConnectionBtn.disabled = false;
        setStatus('idle', 'بانتظار الرد');
        startConnectionTimer();
    } catch (err) {
        console.error('Host init failed:', err);
        showError('فشل إنشاء الغرفة.');
        dom.hostLoading.classList.add('hidden');
    } finally {
        isInitializing = false;
    }
}

async function completeHostConnection() {
    const raw = dom.answerInput.value.trim();
    if (!raw) { showToast('الصق رمز الإجابة أولاً'); return; }
    if (!pc) { showError('لا يوجد اتصال نشط.'); return; }

    dom.completeConnectionBtn.disabled = true;
    dom.completeConnectionBtn.innerHTML = '<div class="spinner spinner-sm"></div> جاري الاتصال...';

    try {
        const answer = decodeTicket(raw);
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await iceManager.flush();
        setStatus('connecting', 'جاري الاتصال...');
        startConnectionTimer();
    } catch (err) {
        showError('رمز الإجابة غير صحيح.');
        dom.completeConnectionBtn.disabled = false;
        dom.completeConnectionBtn.innerHTML = '🔗 إكمال الاتصال';
    }
}

// ---------- Join Flow ----------

async function generateJoinAnswer() {
    const raw = dom.offerInput.value.trim();
    if (!raw) { showToast('الصق رمز الدعوة أولاً'); return; }

    hideError();
    dom.generateAnswerBtn.disabled = true;
    dom.generateAnswerBtn.innerHTML = '<div class="spinner spinner-sm"></div> جاري التجهيز...';

    try {
        const offer = decodeTicket(raw);
        cleanupConnection();
        currentMode = 'join';

        pc = createPeerConnection();
        pc.ondatachannel = (event) => setupDataChannel(event.channel);

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await iceManager.flush();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc);

        const ticket = encodeTicket(pc.localDescription);
        dom.answerOutput.value = ticket;
        dom.copyAnswerBtn.disabled = false;
        dom.showQrAnswerBtn.disabled = false;
        dom.joinAnswerSection.classList.remove('step-locked');
        setStatus('connecting', 'جاري الاتصال...');
        startConnectionTimer();

        dom.generateAnswerBtn.disabled = false;
        dom.generateAnswerBtn.innerHTML = '⚙️ توليد الإجابة';
    } catch (err) {
        console.error('Join failed:', err);
        showError('رمز الدعوة غير صحيح.');
        dom.generateAnswerBtn.disabled = false;
        dom.generateAnswerBtn.innerHTML = '⚙️ توليد الإجابة';
    }
}

// ---------- Chat ----------

function appendMessage(text, type) {
    const row = document.createElement('div');
    row.className = `msg-row msg-${type}`;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

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
    bubble.textContent = text;

    row.appendChild(bubble);
    dom.chatMessages.appendChild(row);
}

function sendMessage() {
    const text = dom.messageInput.value.trim();
    if (!text || !dataChannel || dataChannel.readyState !== 'open') return;
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

    dom.offerOutput.value = '';
    dom.copyOfferBtn.disabled = true;
    dom.showQrOfferBtn.disabled = true;
    dom.hostLoading.classList.remove('hidden');
    dom.hostAnswerSection.classList.add('step-locked');
    dom.answerInput.value = '';
    dom.completeConnectionBtn.disabled = true;
    dom.completeConnectionBtn.innerHTML = '🔗 إكمال الاتصال';

    dom.answerOutput.value = '';
    dom.copyAnswerBtn.disabled = true;
    dom.showQrAnswerBtn.disabled = true;
    dom.joinAnswerSection.classList.add('step-locked');
    dom.generateAnswerBtn.disabled = false;
    dom.generateAnswerBtn.innerHTML = '⚙️ توليد الإجابة';

    showToast('تم قطع الاتصال');
}

// ---------- Events ----------

function bindEvents() {
    dom.modeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            dom.modeTabs.forEach(t => t.classList.remove('active'));
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

    dom.copyOfferBtn.addEventListener('click', () => copyFrom(dom.offerOutput, dom.copyOfferBtn));
    dom.completeConnectionBtn.addEventListener('click', completeHostConnection);

    dom.showQrOfferBtn.addEventListener('click', () => {
        const text = dom.offerOutput.value;
        if (!text) return;
        if (typeof QRCode !== 'undefined') {
            QRCode.toCanvas(dom.offerQrCanvas, text, { width: 256, margin: 2 }, (err) => {
                if (!err) dom.qrOfferBox.classList.remove('hidden');
            });
        } else {
            showToast('مكتبة QR غير محملة');
        }
    });
    dom.downloadQrOfferBtn.addEventListener('click', () => downloadQrCanvas(dom.offerQrCanvas, 'invite-qr.png'));
    dom.closeQrOfferBtn.addEventListener('click', () => dom.qrOfferBox.classList.add('hidden'));

    dom.generateAnswerBtn.addEventListener('click', generateJoinAnswer);
    dom.scanQrBtn.addEventListener('click', startQrScan);
    dom.stopScanBtn.addEventListener('click', stopQrScan);
    dom.copyAnswerBtn.addEventListener('click', () => copyFrom(dom.answerOutput, dom.copyAnswerBtn));

    dom.showQrAnswerBtn.addEventListener('click', () => {
        const text = dom.answerOutput.value;
        if (!text) return;
        if (typeof QRCode !== 'undefined') {
            QRCode.toCanvas(dom.answerQrCanvas, text, { width: 256, margin: 2 }, (err) => {
                if (!err) dom.qrAnswerBox.classList.remove('hidden');
            });
        }
    });
    dom.downloadQrAnswerBtn.addEventListener('click', () => downloadQrCanvas(dom.answerQrCanvas, 'answer-qr.png'));
    dom.closeQrAnswerBtn.addEventListener('click', () => dom.qrAnswerBox.classList.add('hidden'));

    dom.sendBtn.addEventListener('click', sendMessage);
    dom.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    dom.toggleAudioBtn.addEventListener('click', () => {
        if (isAudioCallActive || isVideoCallActive) {
            hangupMedia();
        } else {
            startCall(false);
        }
    });

    dom.toggleVideoBtn.addEventListener('click', () => {
        if (isVideoCallActive) {
            hangupMedia();
        } else {
            startCall(true);
        }
    });

    dom.hangupVideoBtn.addEventListener('click', hangupMedia);

    dom.disconnectBtn.addEventListener('click', disconnect);

    dom.retryBtn.addEventListener('click', () => {
        hideError();
        if (currentMode === 'host') initHostFlow();
        else generateJoinAnswer();
    });

    window.addEventListener('beforeunload', () => {
        cleanupConnection();
    });
}

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();

    // تحميل مكتبة QR للإنتاج
    if (typeof QRCode === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
        script.onload = () => { initHostFlow(); };
        document.head.appendChild(script);
    } else {
        initHostFlow();
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js');
    }
});

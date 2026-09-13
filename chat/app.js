// إعداد خادم Google STUN المجاني لاستخراج الـ IP والبورت الخارجي
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let peerConnection;
let dataChannel;

// 1. إنشاء غرفة جديدة (الطرف الأول)
async function initRoom() {
    document.getElementById('hostBox').classList.remove('hidden');
    document.getElementById('createRoomBtn').disabled = true;

    peerConnection = new RTCPeerConnection(rtcConfig);
    dataChannel = peerConnection.createDataChannel("chat");
    setupDataChannelEvents();

    peerConnection.onicecandidate = (event) => {
        if (!event.candidate) {
            // عند انتهاء جلب البيانات من Google STUN
            const offerTicket = btoa(JSON.stringify(peerConnection.localDescription));
            document.getElementById('offerTicket').value = offerTicket;
            document.getElementById('loadingSpinner').classList.remove('hidden');
            document.getElementById('answerInputBox').classList.remove('hidden');
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
}

// 2. الانضمام لغرفة قائمة (الطرف الثاني)
async function joinRoom() {
    const rawOffer = document.getElementById('remoteOfferInput').value.trim();
    if (!rawOffer) return alert("يرجى إدخال رمز الغرفة أولاً!");

    try {
        const offer = JSON.parse(atob(rawOffer));
        peerConnection = new RTCPeerConnection(rtcConfig);

        peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannelEvents();
        };

        peerConnection.onicecandidate = (event) => {
            if (!event.candidate) {
                const answerTicket = btoa(JSON.stringify(peerConnection.localDescription));
                document.getElementById('answerTicketOutput').value = answerTicket;
                document.getElementById('answerOutputBox').classList.remove('hidden');
            }
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

    } catch (err) {
        alert("رمز الغرفة غير صحيح أو تالف!");
    }
}

// 3. إكمال الاتصال النهائي (عند صانع الغرفة)
async function connectHost() {
    const rawAnswer = document.getElementById('answerTicketInput').value.trim();
    if (!rawAnswer) return alert("يرجى إدخال رمز الإجابة المستلم من صديقك!");

    try {
        const answer = JSON.parse(atob(rawAnswer));
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
        alert("رمز الإجابة غير صحيح!");
    }
}

// إعداد أحداث القناة المباشرة لنقل البيانات
function setupDataChannelEvents() {
    dataChannel.onopen = () => {
        // فتح شاشة المحادثة وإخفاء شاشة الإعداد فور نجاح الاتصال المباشر
        document.getElementById('setupSection').classList.add('hidden');
        document.getElementById('chatSection').classList.remove('hidden');
    };

    dataChannel.onmessage = (event) => {
        appendMessage(event.data, 'received');
    };
}

// إرسال الرسائل النصية
function sendTextMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (text && dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(text);
        appendMessage(text, 'sent');
        input.value = '';
    }
}

function handleKeyPress(e) {
    if (e.key === 'Enter') sendTextMessage();
}

function appendMessage(text, type) {
    const box = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${type}`;
    msgDiv.textContent = text;
    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight;
}

function copyToClipboard(elementId) {
    const text = document.getElementById(elementId);
    text.select();
    navigator.clipboard.writeText(text.value);
    alert("تم نسخ الرمز إلى الحافظة!");
}

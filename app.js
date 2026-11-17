import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  getFirestore, collection, doc, getDoc, setDoc, addDoc, deleteDoc, 
  query, orderBy, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Konfigurasi Firebase Project duitku-tracker
const firebaseConfig = {
  apiKey: "AIzaSyC9uvR0qgqYCPJB7YU_H0uNPNLYeJhGm2Y",
  authDomain: "duitku-tracker-a0b1f.firebaseapp.com",
  projectId: "duitku-tracker-a0b1f",
  storageBucket: "duitku-tracker-a0b1f.firebasestorage.app",
  messagingSenderId: "613323635595",
  appId: "1:613323635595:web:1495c724fce5d5127e8d8e",
  measurementId: "G-KFDFY7NHKQ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Screens
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");
const profileScreen = document.getElementById("profile-screen");

// Auth UI
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const nameField = document.getElementById("name-field");
const submitAuthBtn = document.getElementById("submit-auth-btn");
const authErrorEl = document.getElementById("auth-error");

// Filter & Report UI
const monthFilterEl = document.getElementById("month-filter");

let isRegisterMode = false;
let currentUser = null;
let unsubscribeSnapshot = null;
let allTransactions = [];
let currentFilteredTransactions = [];
let selectedAvatarColor = "10b981";
let pendingCustomPhotoBase64 = null; // Menyimpan hasil kompresi foto profil baru
let isPhotoResetRequested = false;

lucide.createIcons();

// Set Default Bulan ke Bulan Sekarang (Format YYYY-MM)
const now = new Date();
const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
monthFilterEl.value = currentMonthStr;

const formatIDR = (num) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0
}).format(num);

const getDefaultAvatar = (name, color = selectedAvatarColor) => {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "U")}&background=${color}&color=090d16&bold=true`;
};

const getMonthLabel = (ymStr) => {
  const [y, m] = ymStr.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
};

// Fungsi Kompresi & Crop Kotak 1:1 Foto Profil (Auto ~15KB agar muat di Firestore)
function compressProfileImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 200; // Resolusi 200x200 px
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        // Center crop agar gambar tidak gepeng
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;

        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => reject(new Error("Gagal membaca file gambar."));
      img.src = event.target.result;
    };
    reader.onerror = () => reject(new Error("Gagal membuka file."));
    reader.readAsDataURL(file);
  });
}

// ==================== AUTH LOGIC ====================
tabLogin.onclick = () => {
  isRegisterMode = false;
  tabLogin.className = "py-2 rounded-lg text-xs font-bold bg-slate-800 text-white transition";
  tabRegister.className = "py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition";
  nameField.classList.add("hidden");
  submitAuthBtn.textContent = "Masuk Sekarang";
  authErrorEl.classList.add("hidden");
};

tabRegister.onclick = () => {
  isRegisterMode = true;
  tabRegister.className = "py-2 rounded-lg text-xs font-bold bg-slate-800 text-white transition";
  tabLogin.className = "py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition";
  nameField.classList.remove("hidden");
  submitAuthBtn.textContent = "Buat Akun Baru";
  authErrorEl.classList.add("hidden");
};

async function syncUserProfile(user, extraData = {}) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  const existing = snap.exists() ? snap.data() : {};

  const color = extraData.avatarColor || existing.avatarColor || "10b981";
  selectedAvatarColor = color;

  const displayName = extraData.name || existing.name || user.displayName || user.email.split("@")[0];

  let photoURL;
  if (extraData.resetPhoto) {
    photoURL = getDefaultAvatar(displayName, color);
  } else if (extraData.customPhoto) {
    photoURL = extraData.customPhoto;
  } else if (existing.photoURL) {
    photoURL = existing.photoURL.includes("ui-avatars.com")
      ? getDefaultAvatar(displayName, color)
      : existing.photoURL;
  } else if (user.photoURL) {
    photoURL = user.photoURL;
  } else {
    photoURL = getDefaultAvatar(displayName, color);
  }

  await setDoc(userRef, {
    name: displayName,
    email: user.email,
    avatarColor: color,
    photoURL,
    lastLogin: serverTimestamp()
  }, { merge: true });

  return { displayName, photoURL, color };
}

document.getElementById("email-auth-form").onsubmit = async (e) => {
  e.preventDefault();
  authErrorEl.classList.add("hidden");

  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const name = document.getElementById("auth-name").value.trim();

  try {
    if (isRegisterMode) {
      if (!name) throw new Error("Nama panggilan wajib diisi.");
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await syncUserProfile(cred.user, { name });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    authErrorEl.textContent = err.message.replace("Firebase:", "").trim();
    authErrorEl.classList.remove("hidden");
  }
};

document.getElementById("google-login-btn").onclick = async () => {
  try {
    const res = await signInWithPopup(auth, googleProvider);
    await syncUserProfile(res.user);
  } catch (err) {
    authErrorEl.textContent = err.message;
    authErrorEl.classList.remove("hidden");
  }
};

document.getElementById("logout-btn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    authScreen.classList.add("hidden");
    profileScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    appScreen.classList.add("flex");

    const profile = await syncUserProfile(user);
    document.getElementById("user-display-name").textContent = profile.displayName;
    document.getElementById("user-avatar").src = profile.photoURL;

    listenTransactions(user.uid);
  } else {
    appScreen.classList.add("hidden");
    appScreen.classList.remove("flex");
    profileScreen.classList.add("hidden");
    authScreen.classList.remove("hidden");
    if (unsubscribeSnapshot) unsubscribeSnapshot();
  }
  lucide.createIcons();
});

// ==================== EDIT PROFIL PAGE ====================
const photoInput = document.getElementById("profile-photo-input");
const previewAvatar = document.getElementById("profile-preview-avatar");

document.getElementById("open-profile-btn").onclick = () => {
  if (!currentUser) return;
  pendingCustomPhotoBase64 = null;
  isPhotoResetRequested = false;
  photoInput.value = "";

  appScreen.classList.add("hidden");
  appScreen.classList.remove("flex");
  profileScreen.classList.remove("hidden");
  profileScreen.classList.add("flex");

  const currentName = document.getElementById("user-display-name").textContent;
  document.getElementById("profile-name-input").value = currentName;
  document.getElementById("profile-email-display").textContent = currentUser.email;
  previewAvatar.src = document.getElementById("user-avatar").src;
  document.getElementById("profile-feedback").classList.add("hidden");

  const isGoogleUser = currentUser.providerData.some((p) => p.providerId === "google.com");
  document.getElementById("password-update-section").style.display = isGoogleUser ? "none" : "block";
};

document.getElementById("close-profile-btn").onclick = () => {
  profileScreen.classList.add("hidden");
  profileScreen.classList.remove("flex");
  appScreen.classList.remove("hidden");
  appScreen.classList.add("flex");
};

// Event Saat User Memilih Foto Baru dari Galeri/Laptop
photoInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const compressedDataUrl = await compressProfileImage(file);
    pendingCustomPhotoBase64 = compressedDataUrl;
    isPhotoResetRequested = false;
    previewAvatar.src = compressedDataUrl;
  } catch (err) {
    alert(err.message);
  }
});

// Reset Foto ke Avatar Inisial
document.getElementById("reset-photo-btn").onclick = () => {
  pendingCustomPhotoBase64 = null;
  isPhotoResetRequested = true;
  photoInput.value = "";
  const nameVal = document.getElementById("profile-name-input").value.trim() || "User";
  previewAvatar.src = getDefaultAvatar(nameVal, selectedAvatarColor);
};

// Pilih Warna Badge Avatar
document.querySelectorAll(".color-choice").forEach((btn) => {
  btn.onclick = () => {
    selectedAvatarColor = btn.dataset.color;
    document.querySelectorAll(".color-choice").forEach((b) => b.classList.replace("border-white", "border-transparent"));
    btn.classList.replace("border-transparent", "border-white");

    const nameVal = document.getElementById("profile-name-input").value.trim() || "User";
    if (!pendingCustomPhotoBase64 && (isPhotoResetRequested || previewAvatar.src.includes("ui-avatars.com"))) {
      previewAvatar.src = getDefaultAvatar(nameVal, selectedAvatarColor);
    }
  };
});

// Simpan Perubahan Profil
document.getElementById("profile-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const feedbackEl = document.getElementById("profile-feedback");
  const saveBtn = document.getElementById("save-profile-btn");
  feedbackEl.classList.add("hidden");

  const newName = document.getElementById("profile-name-input").value.trim();
  const newPass = document.getElementById("profile-new-password").value;

  try {
    if (!newName) throw new Error("Nama panggilan tidak boleh kosong.");
    saveBtn.disabled = true;
    saveBtn.textContent = "Menyimpan...";

    // Update displayName di Firebase Auth
    await updateProfile(currentUser, { displayName: newName });

    // Simpan foto Base64 & profil ke Firestore (aman dari batas ukuran URL Auth)
    const updatedProfile = await syncUserProfile(currentUser, {
      name: newName,
      avatarColor: selectedAvatarColor,
      customPhoto: pendingCustomPhotoBase64,
      resetPhoto: isPhotoResetRequested
    });

    if (newPass) {
      await updatePassword(currentUser, newPass);
      document.getElementById("profile-new-password").value = "";
    }

    document.getElementById("user-display-name").textContent = updatedProfile.displayName;
    document.getElementById("user-avatar").src = updatedProfile.photoURL;
    previewAvatar.src = updatedProfile.photoURL;

    pendingCustomPhotoBase64 = null;
    isPhotoResetRequested = false;

    feedbackEl.textContent = "Profil & foto berhasil diperbarui!";
    feedbackEl.className = "text-xs text-emerald-400";
    feedbackEl.classList.remove("hidden");
  } catch (err) {
    feedbackEl.textContent = err.message.replace("Firebase:", "").trim();
    feedbackEl.className = "text-xs text-rose-400";
    feedbackEl.classList.remove("hidden");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Simpan Perubahan";
  }
};

// ==================== MODAL & INPUT TRANSAKSI ====================
const modal = document.getElementById("tx-modal");
document.getElementById("open-modal-btn").onclick = () => {
  modal.classList.remove("hidden");
  modal.classList.add("flex");
};
document.getElementById("close-modal-btn").onclick = () => {
  modal.classList.add("hidden");
  modal.classList.remove("flex");
};

const txAmountInput = document.getElementById("tx-amount");
txAmountInput.addEventListener("input", (e) => {
  const rawValue = e.target.value.replace(/\D/g, "");
  e.target.value = rawValue ? Number(rawValue).toLocaleString("id-ID") : "";
});

const categorySelect = document.getElementById("tx-category");
const customCategoryWrapper = document.getElementById("custom-category-wrapper");
const customCategoryInput = document.getElementById("tx-custom-category");

categorySelect.addEventListener("change", () => {
  if (categorySelect.value === "Lainnya") {
    customCategoryWrapper.classList.remove("hidden");
    customCategoryInput.required = true;
    customCategoryInput.focus();
  } else {
    customCategoryWrapper.classList.add("hidden");
    customCategoryInput.required = false;
    customCategoryInput.value = "";
  }
});

// ==================== REALTIME LISTENER & FILTER BULANAN ====================
function listenTransactions(uid) {
  const txRef = collection(db, "users", uid, "transactions");
  const q = query(txRef, orderBy("createdAt", "desc"));

  unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
    allTransactions = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const dateObj = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
      const ym = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}`;

      allTransactions.push({
        id: docSnap.id,
        ...data,
        dateObj,
        ym
      });
    });

    renderMonthlyDashboard();
  });
}

function renderMonthlyDashboard() {
  const selectedYM = monthFilterEl.value || currentMonthStr;
  const periodLabel = getMonthLabel(selectedYM);

  document.getElementById("balance-period-label").textContent = `Saldo ${periodLabel}`;
  document.getElementById("history-title").textContent = `Riwayat • ${periodLabel}`;

  currentFilteredTransactions = allTransactions.filter((tx) => tx.ym === selectedYM);

  let income = 0;
  let expense = 0;
  const txListEl = document.getElementById("transaction-list");
  txListEl.innerHTML = "";
  document.getElementById("tx-count").textContent = `${currentFilteredTransactions.length} catatan`;

  if (currentFilteredTransactions.length === 0) {
    txListEl.innerHTML = `<div class="text-center py-12 text-slate-500 text-sm">Belum ada transaksi di bulan ${periodLabel}.</div>`;
  }

  currentFilteredTransactions.forEach((data) => {
    const amount = Number(data.amount) || 0;
    const isIncome = data.type === "income";

    if (isIncome) income += amount;
    else expense += amount;

    const dateStr = data.dateObj.toLocaleDateString("id-ID", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    });

    const item = document.createElement("div");
    item.className = "glass-card rounded-2xl p-3.5 flex items-center justify-between gap-3";
    item.innerHTML = `
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          isIncome ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
        }">
          <i data-lucide="${isIncome ? "trending-up" : "trending-down"}" class="w-5 h-5"></i>
        </div>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-slate-100 truncate">${data.title}</p>
          <p class="text-[11px] text-slate-400">${data.category} • ${dateStr}</p>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-sm font-bold ${isIncome ? "text-emerald-400" : "text-rose-400"}">
          ${isIncome ? "+" : "-"}${formatIDR(amount)}
        </span>
        <button data-id="${data.id}" class="delete-btn p-1.5 text-slate-500 hover:text-rose-400 transition">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    `;
    txListEl.appendChild(item);
  });

  document.getElementById("total-income").textContent = formatIDR(income);
  document.getElementById("total-expense").textContent = formatIDR(expense);
  document.getElementById("total-balance").textContent = formatIDR(income - expense);

  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (confirm("Hapus catatan transaksi ini?")) {
        await deleteDoc(doc(db, "users", currentUser.uid, "transactions", btn.dataset.id));
      }
    };
  });

  lucide.createIcons();
}

monthFilterEl.addEventListener("change", renderMonthlyDashboard);

// ==================== DOWNLOAD LAPORAN BULANAN (CSV) ====================
document.getElementById("download-report-btn").onclick = () => {
  const selectedYM = monthFilterEl.value || currentMonthStr;
  if (currentFilteredTransactions.length === 0) {
    return alert(`Tidak ada data transaksi pada bulan ${getMonthLabel(selectedYM)} untuk diunduh.`);
  }

  let totalIn = 0;
  let totalOut = 0;

  const rows = [
    ["Tanggal", "Waktu", "Keterangan", "Kategori", "Tipe", "Nominal (Rp)"]
  ];

  const sorted = [...currentFilteredTransactions].reverse();
  sorted.forEach((tx) => {
    const amt = Number(tx.amount) || 0;
    if (tx.type === "income") totalIn += amt;
    else totalOut += amt;

    const tgl = tx.dateObj.toLocaleDateString("id-ID");
    const jam = tx.dateObj.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    const tipe = tx.type === "income" ? "Pemasukan" : "Pengeluaran";
    const safeTitle = `"${String(tx.title).replace(/"/g, '""')}"`;
    const safeCat = `"${String(tx.category).replace(/"/g, '""')}"`;

    rows.push([tgl, jam, safeTitle, safeCat, tipe, amt]);
  });

  rows.push([]);
  rows.push(["REKAP BULAN", getMonthLabel(selectedYM)]);
  rows.push(["Total Pemasukan", "", "", "", "", totalIn]);
  rows.push(["Total Pengeluaran", "", "", "", "", totalOut]);
  rows.push(["Sisa Saldo Bulan Ini", "", "", "", "", totalIn - totalOut]);

  const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.map((r) => r.join(",")).join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Laporan-DuitKu-${selectedYM}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// ==================== SIMPAN TRANSAKSI BARU ====================
document.getElementById("tx-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const type = document.querySelector('input[name="type"]:checked').value;
  const amount = Number(document.getElementById("tx-amount").value.replace(/\./g, ""));
  if (!amount || amount <= 0) return alert("Masukkan nominal yang valid!");

  const title = document.getElementById("tx-title").value.trim();
  const category = categorySelect.value === "Lainnya" 
    ? customCategoryInput.value.trim() 
    : categorySelect.value;

  await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
    type,
    amount,
    title,
    category,
    createdAt: serverTimestamp()
  });

  monthFilterEl.value = currentMonthStr;

  e.target.reset();
  customCategoryWrapper.classList.add("hidden");
  customCategoryInput.required = false;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
};
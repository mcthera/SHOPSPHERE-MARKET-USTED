(function (global) {
  "use strict";

  if (!window.supabase || !window.supabase.createClient) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.insertAdjacentHTML("afterbegin",
        '<div style="background:#b00020;color:#fff;padding:12px;text-align:center;font-weight:700">Could not load the Supabase library. Check your internet connection and refresh.</div>');
    });
    throw new Error("Supabase library failed to load.");
  }

  const SUPABASE_URL = "https://krtbftjnzkjlufligsok.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_uGQjU0wbAtup1XsIRpofpQ_dl2PLTax";
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: window.localStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const CATEGORIES = ["Electronics", "Fashion", "Home", "Mobile", "Beauty", "Groceries", "Sports"];
  const CURRENCIES = {
    GHS: { symbol: "GH₵", locale: "en-GH" },
    NGN: { symbol: "₦", locale: "en-NG" },
    USD: { symbol: "$", locale: "en-US" },
  };
  const CART_KEY = "shopSphereCart";
  let currency = "GHS";
  let toastHost = null;

  // ---------- helpers ----------
  function whatsappNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("233")) return digits;
    if (digits.startsWith("0")) return `233${digits.slice(1)}`;
    return digits;
  }

  function friendlyError(err) {
    const msg = String(err?.message || err || "Something went wrong.");
    if (/invalid login credentials/i.test(msg)) return "Wrong WhatsApp number/email or password.";
    if (/already registered|already been registered/i.test(msg)) return "An account with these details already exists. Try signing in.";
    if (/email not confirmed/i.test(msg)) return "Email not confirmed. Ask the site owner to turn off “Confirm email” in Supabase Auth settings.";
    if (/anonymous sign-ins are disabled/i.test(msg)) return "Please create a customer account or sign in to check out.";
    if (/password should be at least/i.test(msg)) return "Password must be at least 6 characters.";
    if (/failed to fetch|networkerror/i.test(msg)) return "Network problem. Check your connection and try again.";
    if (/request_password_reset|schema cache/i.test(msg)) return "Password reset isn't switched on yet. Please message the moderators on WhatsApp.";
    return msg;
  }

  function phoneToEmail(phone) {
    return `${String(phone || "").replace(/[^0-9]/g, "")}@campus.shopsphere`;
  }

  // ---------- auth ----------
  async function signUp(identifier, password, fullName, phone, role, callLine, secondaryEmail = "") {
    const normalizedEmail = String(identifier || "").trim().toLowerCase();
    const normalizedSecondaryEmail = String(secondaryEmail || "").trim().toLowerCase();
    const normalizedRole = role === "seller" ? "seller" : role === "customer" ? "customer" : null;
    if (!normalizedRole) throw new Error("Choose a valid account type.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Enter a valid email address.");
    if (!String(fullName || "").trim()) throw new Error("Enter your full name.");
    const normalizedPhone = String(phone || "").replace(/[^0-9]/g, "");
    const normalizedCallLine = String(callLine || "").replace(/[^0-9]/g, "");
    if (!normalizedPhone) throw new Error("Enter your WhatsApp number.");
    if (!normalizedCallLine) throw new Error("Enter your call line number.");
    if (normalizedSecondaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedSecondaryEmail)) {
      throw new Error("Enter a valid secondary email address.");
    }
    if (String(password || "").length < 6) throw new Error("Password must be at least 6 characters.");

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          full_name: String(fullName).trim(),
          phone_whatsapp: normalizedPhone,
          phone_call: normalizedCallLine,
          email_secondary: normalizedSecondaryEmail || null,
          role: normalizedRole,
        },
      },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error) throw error;
    return data;
  }

  async function signInAnonymously() {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    saveCart([]);
  }

  async function getCurrentUser() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user) return null;

    const baseColumns = "id, full_name, email, phone_whatsapp, phone_call, role, seller_status";
    let { data: profile, error } = await supabase
      .from("profiles")
      .select(`${baseColumns}, must_change_password`)
      .eq("id", user.id)
      .maybeSingle();
    if (error && (error.code === "42703" || /must_change_password/.test(error.message || ""))) {
      // password-reset.sql has not been run yet: fall back to the old column list
      ({ data: profile, error } = await supabase.from("profiles").select(baseColumns).eq("id", user.id).maybeSingle());
    }
    if (error) throw error;
    if (!profile) {
      console.warn("No profile row found for this account. Did you run supabase-setup.sql?");
      return { ...user, profile: { id: user.id, role: "customer", seller_status: null, full_name: null } };
    }
    return { ...user, profile };
  }

  // ---------- products ----------
  function mapProduct(product) {
    return {
      ...product,
      images: Array.isArray(product.images) ? product.images : [],
      discountPrice: Number(product.discount_price || 0),
      price: Number(product.price || 0),
      stock: Number(product.stock || 0),
      createdAt: new Date(product.created_at).getTime(),
      featuredUntil: product.featured_until ? new Date(product.featured_until).getTime() : 0,
      isFeatured: Boolean(product.featured_until) && new Date(product.featured_until).getTime() > Date.now(),
      sellerVerified: Boolean(product.seller_verified),
    };
  }

  async function getProducts(options = {}) {
    let query = supabase.from("products").select("*").order("created_at", { ascending: false });
    if (options.sellerId) query = query.eq("seller_id", options.sellerId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapProduct);
  }

  // Shrinks big phone photos before upload (falls back to the original file on any problem).
  async function compressImage(file, maxSize = 1280, quality = 0.82) {
    try {
      if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      return blob && blob.size < file.size ? blob : file;
    } catch (err) {
      console.warn("Image compression skipped:", err);
      return file;
    }
  }

  async function uploadImages(files, folderId) {
    const urls = [];
    for (const original of files) {
      const file = await compressImage(original);
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${folderId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (error) throw error;
      urls.push(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
    }
    return urls;
  }

  function assertApprovedSeller(user, action) {
    if (!user || user.profile.role !== "seller") throw new Error(`Sign in with a seller account to ${action}.`);
    if (user.profile.seller_status !== "approved") throw new Error("Your seller account is awaiting moderator approval.");
  }

  async function createProduct(product, imageFiles) {
    const user = await getCurrentUser();
    assertApprovedSeller(user, "post a product");
    if (!imageFiles.length) throw new Error("Choose at least one product photo.");
    const images = await uploadImages(imageFiles, user.id);
    const { data, error } = await supabase
      .from("products")
      .insert({
        seller_id: user.id,
        seller_name: user.profile.full_name || "Verified Seller",
        seller_phone: user.profile.phone_whatsapp || "",
        title: product.title,
        category: product.category,
        price: product.price,
        discount_price: 0,
        stock: product.stock,
        description: product.description || "",
        specs: "",
        images,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async function updateSellerProduct(id, product, imageFiles = []) {
    const user = await getCurrentUser();
    assertApprovedSeller(user, "edit listings");
    const images = imageFiles.length ? await uploadImages(imageFiles, user.id) : product.images;
    if (!Array.isArray(images) || !images.length) throw new Error("Choose at least one product photo.");
    const { data, error } = await supabase
      .from("products")
      .update({
        title: product.title,
        category: product.category,
        price: product.price,
        stock: product.stock,
        description: product.description || "",
        images,
      })
      .eq("id", id)
      .eq("seller_id", user.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The listing was not updated. Check that you own this listing.");
    return data;
  }

  async function updateSellerStock(id, stock) {
    if (!Number.isInteger(stock) || stock < 0) throw new Error("Stock must be a non-negative whole number.");
    const user = await getCurrentUser();
    assertApprovedSeller(user, "update inventory");
    const { data, error } = await supabase
      .from("products")
      .update({ stock })
      .eq("id", id)
      .eq("seller_id", user.id)
      .select("id, stock, stock_before_out, last_updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Inventory was not updated. Check that you own this listing.");
    return data;
  }

  async function deleteProduct(id) {
    const { data, error } = await supabase.from("products").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The product was not deleted. Check your account permissions.");
  }

  // ---------- orders ----------
  async function createOrder(customer, items) {
    const user = await getCurrentUser();
    if (!user || user.profile.role !== "customer") {
      throw new Error("Sign in with a customer account before checking out.");
    }
    const { data, error } = await supabase.rpc("place_order", {
      p_customer_name: customer.name,
      p_customer_phone: customer.phone,
      p_customer_address: customer.address,
      p_class_name: customer.className,
      p_index_number: customer.indexNumber,
      p_items: items.map((item) => ({ product_id: item.id, quantity: item.qty })),
    });
    if (error) throw error;
    const order = Array.isArray(data) ? data[0] : data;
    if (!order) throw new Error("The order was not saved.");
    return order;
  }

  async function getOrder(reference) {
    const user = await getCurrentUser();
    if (!user) throw new Error("Sign in to track your orders.");
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, customer_id, customer_name, customer_phone, customer_address, class_name, index_number, items, total, status, created_at")
      .eq("reference", String(reference || "").trim().toUpperCase())
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getMyOrders() {
    const user = await getCurrentUser();
    if (!user) throw new Error("Sign in to see your orders.");
    const { data, error } = await supabase
      .from("orders")
      .select("id, reference, items, total, status, created_at")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  async function getSellerOrders() {
    const { data, error } = await supabase.rpc("get_seller_orders");
    if (error) throw error;
    return data || [];
  }

  // ---------- passwords (change + "forgot") shared by every page ----------
  async function changePassword(newPassword) {
    if (String(newPassword || "").length < 6) throw new Error("Password must be at least 6 characters.");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    // clear the "moderator reset this for you" flag (ignored if the column does not exist yet)
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (uid) {
      const { error: flagError } = await supabase.from("profiles").update({ must_change_password: false }).eq("id", uid);
      if (flagError) console.warn("Could not clear the password flag:", flagError.message);
    }
  }

  async function requestPasswordReset(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length < 9) throw new Error("Enter the WhatsApp number you registered with.");
    const { error } = await supabase.rpc("request_password_reset", { p_phone: digits });
    if (error) throw error;
  }

  function buildModal(id, title, bodyHTML) {
    let modal = document.getElementById(id);
    if (modal) modal.remove();
    modal = document.createElement("div");
    modal.id = id;
    modal.className = "modal";
    modal.style.cssText = "z-index:3000;background:rgba(0,0,0,.6)";
    modal.innerHTML = `<div class="modal__panel modal__panel--sm">
      <div class="modal__head"><h3>${title}</h3><button type="button" class="close-x" aria-label="Close">×</button></div>
      <div class="modal__body">${bodyHTML}</div></div>`;
    document.body.appendChild(modal);
    const close = () => modal.classList.remove("open");
    modal.querySelector(".close-x").addEventListener("click", close);
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    requestAnimationFrame(() => modal.classList.add("open"));
    return { modal, close };
  }

  function openChangePasswordModal(forced = false) {
    const { modal, close } = buildModal("ssChangePwModal", "Change password", `
      ${forced ? '<p style="margin-bottom:12px;color:var(--red-dark);font-weight:700">A moderator gave you a temporary password. Please choose your own now.</p>' : ""}
      <form id="ssChangePwForm">
        <div class="field"><label for="ssNewPw">New password *</label><input type="password" id="ssNewPw" minlength="6" autocomplete="new-password" required /></div>
        <div class="field"><label for="ssNewPw2">Repeat new password *</label><input type="password" id="ssNewPw2" minlength="6" autocomplete="new-password" required /></div>
        <button type="submit" class="btn btn--primary btn--block" id="ssChangePwBtn">Save new password</button>
      </form>`);
    modal.querySelector("#ssChangePwForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const first = modal.querySelector("#ssNewPw").value;
      if (first !== modal.querySelector("#ssNewPw2").value) { toast("The two passwords don't match.", "error"); return; }
      const button = modal.querySelector("#ssChangePwBtn");
      button.disabled = true;
      try {
        await changePassword(first);
        toast("Password changed ✅");
        close();
      } catch (err) {
        console.error("Could not change password:", err);
        toast(friendlyError(err), "error", 6000);
      } finally {
        button.disabled = false;
      }
    });
  }

  function openForgotPasswordModal() {
    const { modal } = buildModal("ssForgotPwModal", "Forgot your password?", `
      <p style="margin-bottom:12px;color:var(--muted)">Enter the WhatsApp number you registered with. A moderator will confirm it's really you, then send you a temporary password on WhatsApp.</p>
      <form id="ssForgotForm">
        <div class="field"><label for="ssForgotPhone">WhatsApp number *</label><input type="tel" id="ssForgotPhone" placeholder="e.g. 0597787700" autocomplete="tel" required /></div>
        <button type="submit" class="btn btn--primary btn--block" id="ssForgotBtn">Send reset request</button>
      </form>
      <div id="ssForgotDone" class="hidden"></div>`);
    modal.querySelector("#ssForgotForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const phone = modal.querySelector("#ssForgotPhone").value;
      const button = modal.querySelector("#ssForgotBtn");
      button.disabled = true;
      try {
        await requestPasswordReset(phone);
        const text = encodeURIComponent(`Hi, I forgot my ShopSphere password. My number is ${phone.replace(/[^0-9]/g, "")}.`);
        modal.querySelector("#ssForgotForm").classList.add("hidden");
        const done = modal.querySelector("#ssForgotDone");
        done.classList.remove("hidden");
        done.innerHTML = `<p style="font-weight:700;margin-bottom:8px">Request sent ✅</p>
          <p style="color:var(--muted);margin-bottom:12px">If that number is registered, the moderators can now see your request. To speed things up, message them on WhatsApp so they can confirm it's you.</p>
          <a class="btn btn--green btn--block" target="_blank" rel="noopener" href="https://wa.me/233597787700?text=${text}">💬 Message the moderators</a>`;
      } catch (err) {
        console.error("Reset request failed:", err);
        toast(friendlyError(err), "error", 6000);
        button.disabled = false;
      }
    });
  }

  // when a moderator has reset someone's password, make them pick their own right after sign-in
  let pwCheckTimer = null;
  async function checkForcedPasswordChange() {
    try {
      const user = await getCurrentUser();
      if (user?.profile?.must_change_password && !document.getElementById("ssChangePwModal")?.classList.contains("open")) {
        openChangePasswordModal(true);
      }
    } catch (err) {
      console.warn("Password check skipped:", err.message || err);
    }
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (!session || (event !== "SIGNED_IN" && event !== "INITIAL_SESSION")) return;
    clearTimeout(pwCheckTimer);
    pwCheckTimer = setTimeout(checkForcedPasswordChange, 600); // never call Supabase inside this callback directly
  });


  // Asks the "send-sms" Edge Function (Arkesel) to text the store owner(s) of this order.
  // Only the order id is sent; the server works out who to text and what to say.
  // Never throws: a failed SMS must not break checkout. Check the Console for the reason.
  async function notifyOrder(orderId) {
    try {
      const { data, error } = await supabase.functions.invoke("send-sms", { body: { order_id: orderId } });
      if (error) {
        let detail = error.message;
        try { detail = JSON.stringify(await error.context.json()); } catch (_) { /* response had no JSON body */ }
        console.warn("Order SMS failed:", detail);
        return { ok: false, error: detail };
      }
      console.log("Order SMS result:", data);
      return data;
    } catch (err) {
      console.warn("Order SMS failed:", err);
      return { ok: false, error: String(err?.message || err) };
    }
  }

  async function updateOrderStatus(orderId, status) {
    const { data, error } = await supabase.rpc("update_order_status", { p_order_id: orderId, p_status: status });
    if (error) throw error;
    if (!data) throw new Error("The order status was not updated.");
    return data;
  }

  // ---------- ad banners ----------
  function isBannerLive(banner, now = Date.now()) {
    if (!banner || !banner.is_active) return false;
    if (banner.starts_at && new Date(banner.starts_at).getTime() > now) return false;
    if (banner.ends_at && new Date(banner.ends_at).getTime() < now) return false;
    return true;
  }

  async function getLiveBanners() {
    const { data, error } = await supabase
      .from("banners")
      .select("id, advertiser, headline, subtext, button_text, image_url, whatsapp, link_url, starts_at, ends_at, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).filter((banner) => isBannerLive(banner));
  }

  // how many ad banners the homepage may show at once (moderator setting, default 4)
  async function getMaxBanners() {
    try {
      const { data, error } = await supabase.from("site_settings").select("value").eq("key", "max_banners").maybeSingle();
      if (error) throw error;
      const value = Number.parseInt(data?.value, 10);
      return Number.isInteger(value) && value >= 1 && value <= 20 ? value : 4;
    } catch (err) {
      console.warn("Using default banner cap (run supabase-featured.sql):", err.message || err);
      return 4;
    }
  }

  // fire-and-forget: a counting problem must never break the page
  function trackBanner(id, event) {
    if (!id) return;
    try {
      if (event === "view") {
        const key = `ssBannerView_${id}`;
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      }
    } catch (err) {
      console.warn("Session storage unavailable:", err);
    }
    supabase.rpc("track_banner", { p_banner_id: id, p_event: event })
      .then(({ error }) => { if (error) console.warn("Banner tracking failed:", error.message); })
      .catch((err) => console.warn("Banner tracking failed:", err));
  }

  // ---------- cart (persisted in this browser) ----------
  function getCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(parsed)
        ? parsed.filter((item) => item && typeof item.id === "string" && Number.isInteger(item.qty) && item.qty > 0)
        : [];
    } catch (err) {
      console.warn("Could not read saved cart:", err);
      return [];
    }
  }

  function saveCart(nextCart) {
    const clean = Array.isArray(nextCart)
      ? nextCart.filter((item) => item && typeof item.id === "string" && Number.isInteger(item.qty) && item.qty > 0)
      : [];
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(clean));
    } catch (err) {
      console.warn("Could not save cart:", err);
    }
  }

  // ---------- currency + toast ----------
  function getCurrency() { return currency; }
  function setCurrency(code) {
    if (!CURRENCIES[code]) throw new Error("Unsupported currency.");
    currency = code;
  }
  function formatPrice(amount, currencyCode) {
    const config = CURRENCIES[currencyCode || currency] || CURRENCIES.GHS;
    const value = Number(amount || 0);
    return `${config.symbol}${value.toLocaleString(config.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function toast(message, type = "success", duration = 2600) {
    if (!toastHost) {
      toastHost = document.getElementById("toastHost") || document.createElement("div");
      toastHost.id = "toastHost";
      toastHost.className = "toast-host";
      if (!toastHost.isConnected) document.body.appendChild(toastHost);
    }
    const element = document.createElement("div");
    element.className = `toast toast--${type}`;
    const dot = document.createElement("span");
    dot.className = "toast__dot";
    const text = document.createElement("span");
    text.textContent = String(message);
    element.append(dot, text);
    toastHost.appendChild(element);
    requestAnimationFrame(() => element.classList.add("toast--show"));
    setTimeout(() => {
      element.classList.remove("toast--show");
      setTimeout(() => element.remove(), 300);
    }, duration);
  }

  global.Store = {
    supabase, CATEGORIES, CURRENCIES,
    signUp, signIn, signInAnonymously, signOut, getCurrentUser,
    getProducts, createProduct, updateSellerProduct, updateSellerStock, deleteProduct, uploadImages,
    createOrder, getOrder, getMyOrders, getSellerOrders, notifyOrder, updateOrderStatus,
    changePassword, requestPasswordReset, openChangePasswordModal, openForgotPasswordModal,
    getCart, saveCart, formatPrice, getCurrency, setCurrency,
    toast, whatsappNumber, friendlyError, phoneToEmail,
    isBannerLive, getLiveBanners, getMaxBanners, trackBanner,
  };
})(window);
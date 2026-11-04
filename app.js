(function () {
  "use strict";
  const S = window.Store;
  const SELLER_BANNER_DISMISSED_KEY = "shopSphereHideSellerBanner";
  let currentUser = null;
  let sellerBannerDismissed = false;
  let loadedProducts = [];
  let authMode = "signin";
  let authRole = "customer";

  const state = {
    activeCategory: "All",
    search: "",
    sort: "new",
    carouselIndex: 0,
  };

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  const sellPrice = (p) => (p.discountPrice > 0 ? p.discountPrice : p.price);

  const PLACEHOLDER_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='#f4eeee'/><text x='50%' y='52%' font-size='96' text-anchor='middle'>🛍️</text></svg>"
  );
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const SLIDES = [
    { title: "Buy and sell on campus", sub: "Textbooks, gadgets, fashion and room essentials from students you can meet today.", tone: "crimson", art: "🎓", cta: "Browse items" },
    { title: "Got something to sell?", sub: "Open the menu, tap Become a Seller and reach buyers on WhatsApp in minutes.", tone: "deep", art: "📱", cta: "See what's listed", cat: "Mobile" },
    { title: "Hostel shopping sorted", sub: "Fans, kettles, bedding and more at student-friendly prices.", tone: "bright", art: "🛏️", cta: "Shop home items", cat: "Home" },
  ];

  async function init() {
    $("#year").textContent = new Date().getFullYear();
    const currencySelect = $("#currencySel");
    if (currencySelect) currencySelect.value = S.getCurrency();

    try {
      sellerBannerDismissed = localStorage.getItem(SELLER_BANNER_DISMISSED_KEY) === "true";
    } catch (err) {
      console.error("Could not restore seller-banner preference:", err);
      S.toast("Could not restore your seller-banner preference.", "error");
    }

    updateAuthUI();
    buildCarousel();
    loadBanners();
    buildCategories();
    updateCartCount();
    wireEvents();

    const query = new URLSearchParams(window.location.search);
    try {
      currentUser = await S.getCurrentUser();
      updateAuthUI();
    } catch (err) {
      console.error("Could not restore sign-in state:", err);
      S.toast(`Could not restore your Supabase session: ${err.message}`, "error", 6000);
    }

    if (query.get("signup") === "seller") {
      openSellerAuthModal();
      query.delete("signup");
      const remainingQuery = query.toString();
      history.replaceState(null, "", `${location.pathname}${remainingQuery ? `?${remainingQuery}` : ""}${location.hash}`);
    } else if (!currentUser) {
      $("#gatewayModal").classList.add("open");
    } else {
      $("#gatewayModal").classList.remove("open");
    }
    await fetchAndRenderProducts();
  }

  let slides = SLIDES.map((slide) => ({ kind: "house", ...slide }));
  let carouselWired = false;

  function adLink(ad) {
    const number = S.whatsappNumber(ad.whatsapp);
    if (number) return `https://wa.me/${number}?text=${encodeURIComponent("Hi, I saw your ad on ShopSphere.")}`;
    return /^https?:\/\//i.test(ad.link_url || "") ? ad.link_url : "";
  }

  function slideHTML(slide) {
    if (slide.kind !== "ad") {
      return `
      <div class="slide slide--${slide.tone}">
        <span class="slide__art" aria-hidden="true">${slide.art}</span>
        <h2>${escapeHTML(slide.title)}</h2><p>${escapeHTML(slide.sub)}</p>
        <button type="button" class="btn btn--white" data-scroll-products${slide.cat ? ` data-slide-cat="${escapeHTML(slide.cat)}"` : ""}>${escapeHTML(slide.cta)}</button>
      </div>`;
    }
    const ad = slide.ad;
    const href = adLink(ad);
    const hasText = Boolean(ad.headline || ad.subtext);
    const tag = href ? "a" : "div";
    const attrs = href
      ? ` href="${escapeHTML(href)}" target="_blank" rel="noopener sponsored" data-ad-id="${escapeHTML(ad.id)}"`
      : "";
    return `
      <${tag} class="slide slide--ad slide--deep${hasText ? " has-text" : ""}"${attrs} aria-label="Sponsored: ${escapeHTML(ad.advertiser)}">
        ${ad.image_url ? `<img class="slide__bg" src="${escapeHTML(ad.image_url)}" alt="${escapeHTML(ad.headline || ad.advertiser)}" decoding="async">` : ""}
        <span class="slide__tag">Sponsored</span>
        ${ad.headline ? `<h2>${escapeHTML(ad.headline)}</h2>` : ""}
        ${ad.subtext ? `<p>${escapeHTML(ad.subtext)}</p>` : ""}
        ${hasText && href ? `<span class="btn btn--white">${escapeHTML(ad.button_text || "Learn more")}</span>` : ""}
      </${tag}>`;
  }

  function renderSlides() {
    $("#carouselTrack").innerHTML = slides.map(slideHTML).join("");
    $("#carDots").innerHTML = slides.map((_, index) =>
      `<button type="button" data-dot="${index}" class="${index === 0 ? "active" : ""}" aria-label="Show slide ${index + 1}"></button>`
    ).join("");
    $$("[data-dot]").forEach((button) =>
      button.addEventListener("click", () => goToSlide(Number(button.dataset.dot)))
    );
    goToSlide(0);
  }

  function buildCarousel() {
    renderSlides();
    if (carouselWired) return;
    carouselWired = true;
    $("#carPrev").addEventListener("click", () => goToSlide(state.carouselIndex - 1));
    $("#carNext").addEventListener("click", () => goToSlide(state.carouselIndex + 1));

    const carousel = $("#carousel");
    // one delegated handler: counts ad clicks and makes the house slide buttons work
    carousel.addEventListener("click", (e) => {
      const ad = e.target.closest("[data-ad-id]");
      if (ad) { S.trackBanner(ad.dataset.adId, "click"); return; }
      const cta = e.target.closest("[data-scroll-products]");
      if (cta) {
        setCategory(cta.dataset.slideCat || "All");
        $("#productsHead").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }
    });

    let touchX = null;
    carousel.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    carousel.addEventListener("touchend", (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 40) goToSlide(state.carouselIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });

    if (!reduceMotion) {
      setInterval(() => {
        if (document.visibilityState === "visible") goToSlide(state.carouselIndex + 1);
      }, 6000);
    }
  }

  // paid banners go first, then the built-in slides
  async function loadBanners() {
    try {
      const [allAds, maxAds] = await Promise.all([S.getLiveBanners(), S.getMaxBanners()]);
      const ads = allAds.slice(0, maxAds);
      if (!ads.length) return;
      slides = [
        ...ads.map((ad) => ({ kind: "ad", ad })),
        ...SLIDES.map((slide) => ({ kind: "house", ...slide })),
      ];
      renderSlides();
    } catch (err) {
      console.warn("Could not load ad banners (run supabase-banners.sql if you haven't):", err);
    }
  }

  function goToSlide(index) {
    state.carouselIndex = ((index % slides.length) + slides.length) % slides.length;
    $("#carouselTrack").style.transform = `translateX(-${state.carouselIndex * 100}%)`;
    $$("[data-dot]").forEach((button, idx) =>
      button.classList.toggle("active", idx === state.carouselIndex)
    );
    const current = slides[state.carouselIndex];
    if (current?.kind === "ad" && document.visibilityState === "visible") S.trackBanner(current.ad.id, "view");
  }

  function updateAuthUI() {
    const name = currentUser ? (currentUser.profile?.full_name || currentUser.email || "Guest") : "";
    $("#authLabel").textContent = currentUser ? "Log out" : "Customer Sign in";
    $("#drawerUserName").textContent = currentUser ? name : "Welcome";
    $("#drawerUserSub").textContent = currentUser ? `Role: ${currentUser.profile?.role || "customer"}` : "Sign in to ShopSphere";
    $("#drawerAvatar").textContent = currentUser ? name.trim().charAt(0).toUpperCase() || "S" : "S";
    const isSeller = currentUser && currentUser.profile?.role === "seller";
    $("#btnSellerSignupPrompt").classList.toggle("hidden", Boolean(isSeller));
    $("#btnDrawerSellerDashboard").classList.toggle("hidden", !isSeller);
    $("#sellerAlertBanner").classList.toggle("hidden", Boolean(isSeller) || sellerBannerDismissed);
  }

  function dismissSellerBanner() {
    sellerBannerDismissed = true;
    $("#sellerAlertBanner").classList.add("hidden");
    try {
      localStorage.setItem(SELLER_BANNER_DISMISSED_KEY, "true");
    } catch (err) {
      console.error("Could not save seller-banner preference:", err);
      S.toast("Could not save your seller-banner preference.", "error");
    }
  }

  const CAT_EMOJI = { All: "🛍️", Electronics: "💻", Fashion: "👗", Home: "🏠", Mobile: "📱", Beauty: "💄", Groceries: "🛒", Sports: "⚽" };

  function buildCategories() {
    $("#catTiles").innerHTML = ["All", ...S.CATEGORIES].map((c) => `
      <button type="button" class="cat-tile${c === state.activeCategory ? " active" : ""}" data-cat="${escapeHTML(c)}" aria-pressed="${c === state.activeCategory}">
        <span class="emoji" aria-hidden="true">${CAT_EMOJI[c] || "🏷️"}</span>${escapeHTML(c)}
      </button>`).join("");
    $$("[data-cat]").forEach((btn) =>
      btn.addEventListener("click", () => setCategory(btn.dataset.cat))
    );
  }

  function setCategory(cat) {
    state.activeCategory = cat;
    state.search = "";
    $("#searchInput").value = "";
    renderProducts();
  }

  function syncCategoryUI() {
    $$("[data-cat]").forEach((b) => {
      const on = b.dataset.cat === state.activeCategory;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    $("#productsTitle").textContent = state.search
      ? `Results for “${state.search}”`
      : state.activeCategory === "All" ? "All products" : state.activeCategory;
  }

  function scrollToProducts() {
    const header = $(".header");
    const top = $("#productsHead").getBoundingClientRect().top + window.scrollY - (header ? header.offsetHeight : 0) - 12;
    window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  }

  async function fetchAndRenderProducts() {
    try {
      loadedProducts = await S.getProducts();
      reconcileCart();
      renderProducts();
    } catch (err) {
      console.error("Could not load products:", err);
      loadedProducts = [];
      renderProducts();
      S.toast("Could not load products. Check your connection and refresh.", "error", 6000);
    }
  }

  // drop deleted products from the saved cart and clamp quantities to available stock
  function reconcileCart() {
    const cart = S.getCart();
    const next = cart
      .map((item) => {
        const product = loadedProducts.find((p) => p.id === item.id);
        if (!product || product.stock <= 0) return null;
        return { id: item.id, qty: Math.min(item.qty, product.stock) };
      })
      .filter(Boolean);
    if (JSON.stringify(next) !== JSON.stringify(cart)) S.saveCart(next);
    updateCartCount();
  }

  function filteredProducts() {
    let list = [...loadedProducts];
    if (state.activeCategory !== "All") list = list.filter(p => p.category === state.activeCategory);
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(p => p.title.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q));
    }
    switch (state.sort) {
      case "price-asc": list.sort((a, b) => sellPrice(a) - sellPrice(b)); break;
      case "price-desc": list.sort((a, b) => sellPrice(b) - sellPrice(a)); break;
      case "rating": list.sort((a, b) => (b.rating || 4) - (a.rating || 4)); break;
      // paid "Featured" listings sit at the top of Newest, then newest first
      default: list.sort((a, b) => (Number(b.isFeatured) - Number(a.isFeatured)) || ((b.createdAt || 0) - (a.createdAt || 0)));
    }
    return list;
  }

  function renderProducts() {
    const list = filteredProducts();
    const grid = $("#productGrid");
    $("#noResults").classList.toggle("hidden", list.length > 0);
    $("#resultCount").textContent = list.length ? `${list.length} item${list.length === 1 ? "" : "s"}` : "";
    syncCategoryUI();

    grid.innerHTML = list.map((p) => {
      const img = p.images?.[0] || PLACEHOLDER_IMG;
      const price = sellPrice(p);
      const onSale = p.discountPrice > 0 && p.discountPrice < p.price;
      const off = onSale ? Math.round((1 - p.discountPrice / p.price) * 100) : 0;
      const soldOut = p.stock <= 0;
      return `
      <article class="card" data-id="${escapeHTML(p.id)}">
        <div class="card__media">
          <img src="${escapeHTML(img)}" alt="${escapeHTML(p.title)}" loading="lazy" />
          <span class="card__tag">${escapeHTML(p.category)}</span>
          ${onSale ? `<span class="card__disc">-${off}%</span>` : ""}
          ${p.isFeatured ? `<span class="card__feat">⭐ Featured</span>` : ""}
          ${soldOut ? `<div class="card__soldout">Sold out</div>` : ""}
        </div>
        <div class="card__body">
          <h3 class="card__title">${escapeHTML(p.title)}</h3>
          <div class="card__price">
            <span class="now">${S.formatPrice(price)}</span>
            ${onSale ? `<span class="was">${S.formatPrice(p.price)}</span>` : ""}
          </div>
          <p class="card__seller">Sold by <strong>${escapeHTML(p.seller_name || "Seller")}</strong>${p.sellerVerified ? ` <span class="verified-badge" title="Campus Verified by ShopSphere moderators">⭐ Campus Verified</span>` : ""}</p>
          <div class="card__actions">
            <button type="button" class="btn btn--ghost" data-cart-id="${escapeHTML(p.id)}"${soldOut ? " disabled" : ""}>Add to cart</button>
            <button type="button" class="btn btn--primary" data-seller-phone="${escapeHTML(p.seller_phone || "")}" data-seller-title="${escapeHTML(p.title)}">WhatsApp</button>
          </div>
        </div>
      </article>`;
    }).join("");
    $$("[data-cart-id]", grid).forEach((button) =>
      button.addEventListener("click", () => window.addToCart(button.dataset.cartId))
    );
    $$("[data-seller-phone]", grid).forEach((button) =>
      button.addEventListener("click", () => window.contactSeller(button.dataset.sellerPhone, button.dataset.sellerTitle))
    );
  }

  window.contactSeller = function(phone, title) {
    if (!phone) { S.toast("Seller phone number not available", "error"); return; }
    const cleanPhone = S.whatsappNumber(phone);
    const msg = encodeURIComponent(`Hello! I am interested in buying your item "${title}" listed on ShopSphere.`);
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, "_blank");
  };

  window.addToCart = function(id) {
    const p = loadedProducts.find(x => x.id === id);
    if (!p || p.stock <= 0) {
      S.toast("This item is unavailable.", "error");
      return;
    }
    const cart = S.getCart();
    const item = cart.find(c => c.id === id);
    if (item && item.qty >= p.stock) {
      S.toast(`Only ${p.stock} in stock`, "error");
      return;
    }
    if (item) item.qty += 1;
    else cart.push({ id, qty: 1 });
    S.saveCart(cart);
    updateCartCount();
    S.toast("Product added to cart 🛒");
  };

  function updateCartCount() {
    const n = S.getCart().reduce((s, c) => s + c.qty, 0);
    $("#cartCount").textContent = n;
  }

  function cartTotal() {
    return S.getCart().reduce((total, item) => {
      const product = loadedProducts.find((p) => p.id === item.id);
      return total + (product ? sellPrice(product) * item.qty : 0);
    }, 0);
  }

  function renderCart() {
    const cart = S.getCart();
    const body = $("#cartBody");
    const foot = $("#cartFoot");
    if (!cart.length) {
      body.innerHTML = '<div class="empty"><div class="big">🛒</div><p>Your cart is empty.</p></div>';
      foot.innerHTML = "";
      return;
    }

    body.innerHTML = cart.map((item) => {
      const product = loadedProducts.find((p) => p.id === item.id);
      if (!product) {
        return `<div class="cart-line"><div class="cart-line__info"><p>Item no longer available.</p>
          <button type="button" class="link-remove" data-rem="${item.id}">Remove</button></div></div>`;
      }
      const image = Array.isArray(product.images) ? product.images[0] : "";
      return `<div class="cart-line">
        ${image ? `<img src="${escapeHTML(image)}" alt="">` : ""}
        <div class="cart-line__info">
          <h4>${escapeHTML(product.title)}</h4>
          <div>${S.formatPrice(sellPrice(product))}</div>
          <div class="qty" style="margin-top:6px">
            <button type="button" data-dec="${product.id}">−</button>
            <span>${item.qty}</span>
            <button type="button" data-inc="${product.id}">+</button>
          </div>
          <div><button type="button" class="link-remove" data-rem="${product.id}">Remove</button></div>
        </div>
        <strong>${S.formatPrice(sellPrice(product) * item.qty)}</strong>
      </div>`;
    }).join("");

    foot.innerHTML = `<div class="cart-summary-row total"><span>Total</span><span>${S.formatPrice(cartTotal())}</span></div>
      <button type="button" class="btn btn--green btn--block" id="goCheckout">Checkout via WhatsApp</button>`;
    $$("[data-inc]", body).forEach((button) => button.addEventListener("click", () => changeCartQty(button.dataset.inc, 1)));
    $$("[data-dec]", body).forEach((button) => button.addEventListener("click", () => changeCartQty(button.dataset.dec, -1)));
    $$("[data-rem]", body).forEach((button) => button.addEventListener("click", () => removeCartItem(button.dataset.rem)));
    $("#goCheckout").addEventListener("click", openCheckout);
  }

  function changeCartQty(id, delta) {
    const cart = S.getCart();
    const item = cart.find((entry) => entry.id === id);
    const product = loadedProducts.find((entry) => entry.id === id);
    if (!item || !product) return;
    const quantity = item.qty + delta;
    if (quantity < 1) return removeCartItem(id);
    if (quantity > product.stock) {
      S.toast(`Only ${product.stock} in stock`, "error");
      return;
    }
    item.qty = quantity;
    S.saveCart(cart);
    updateCartCount();
    renderCart();
  }

  function removeCartItem(id) {
    S.saveCart(S.getCart().filter((item) => item.id !== id));
    updateCartCount();
    renderCart();
  }

  function openCart() {
    renderCart();
    openDrawer("cartDrawer");
  }

  function openCheckout() {
    const cart = S.getCart();
    if (!cart.length) {
      S.toast("Your cart is empty.", "error");
      return;
    }
    if (currentUser && currentUser.profile?.role !== "customer") {
      S.toast("Sellers and moderators can't place orders. Use a customer account.", "error");
      closeDrawer("cartDrawer");
      return;
    }
    const profile = currentUser?.profile;
    if (profile?.full_name && !$("#checkoutName").value) $("#checkoutName").value = profile.full_name;
    if (profile?.phone_whatsapp && !$("#checkoutPhone").value) $("#checkoutPhone").value = profile.phone_whatsapp;
    $("#checkoutSummary").innerHTML = `<div class="cart-summary-row total"><span>Total</span><span>${S.formatPrice(cartTotal())}</span></div>`;
    closeDrawer("cartDrawer");
    openModal("checkoutModal");
  }

  async function submitWhatsAppOrder(event) {
    event.preventDefault();
    const cart = S.getCart();
    if (!cart.length) return;

    const form = $("#checkoutForm");
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const customer = {
      name: String(formData.get("name") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      address: String(formData.get("address") || "").trim(),
      className: String(formData.get("className") || "").trim(),
      indexNumber: String(formData.get("indexNumber") || "").trim() || "Not provided"
    };
    submitButton.disabled = true;
    const whatsappWindow = window.open("about:blank", "_blank");

    try {
      if (!currentUser) {
        await S.signInAnonymously();
        currentUser = await S.getCurrentUser();
        if (!currentUser) throw new Error("Could not start a guest checkout session.");
        updateAuthUI();
      }
      const order = await S.createOrder(customer, cart);

      S.notifyOrder(order.id); // not awaited: checkout must never wait for an SMS
      const message = [
        "*New ShopSphere Campus Order* 🛒",
        `Order Reference ID: *${order.reference}*`,
        `Name: ${customer.name}`,
        `Phone: ${customer.phone}`,
        `Class: ${customer.className}`,
        `Index Number: ${customer.indexNumber}`,
        `Location: ${customer.address}`,
        "",
        "*Items Ordered:*",
        ...(order.items || []).map((item) => `• ${item.title} (x${item.qty}) — ${S.formatPrice(item.price * item.qty)}`),
        "",
        `*Total: ${S.formatPrice(order.total)}*`,
      ].join("\n");

      S.saveCart([]);
      updateCartCount();
      renderCart();
      closeModal("checkoutModal");
      closeDrawer("cartDrawer");
      const url = `https://wa.me/233597787700?text=${encodeURIComponent(message)}`;
      if (whatsappWindow) whatsappWindow.location.href = url;
      showOrderSuccess(order, url);
      await fetchAndRenderProducts();
    } catch (err) {
      if (whatsappWindow) whatsappWindow.close();
      console.error("Order failed:", err);
      S.toast(S.friendlyError(err) || "Could not save your order.", "error", 7000);
      if (/anonymous sign-ins are disabled/i.test(String(err?.message))) {
        closeModal("checkoutModal");
        setAuthMode("signup", "customer");
        openModal("authModal");
      }
    } finally {
      submitButton.disabled = false;
    }
  }

  const STATUS_HINT = {
    Pending: "The seller has your order and is getting it ready.",
    Shipped: "On its way. Meet the seller and pay on delivery.",
    Delivered: "Delivered. Thank you for shopping on campus!",
    Canceled: "This order was canceled. Contact the seller on WhatsApp if you have questions.",
  };

  function orderCardHTML(order) {
    return `
      <div style="border: 1px solid var(--line); padding: 12px; border-radius: 10px; margin-bottom: 10px; background: var(--bg);">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong>Order: ${escapeHTML(order.reference)}</strong>
          <span class="status-pill status-${escapeHTML(order.status)}">${escapeHTML(order.status)}</span>
        </div>
        <p style="font-size:0.85rem; color:var(--muted); margin-top:4px;">Placed: ${escapeHTML(new Date(order.created_at).toLocaleString())}</p>
        <div style="margin-top:6px; font-size:0.88rem;">
          ${(order.items || []).map((item) => `<div>• ${escapeHTML(item.title)} (x${escapeHTML(item.qty)})</div>`).join("")}
        </div>
        <p style="margin-top:6px;font-weight:800">Total: ${S.formatPrice(order.total)}</p>
        ${STATUS_HINT[order.status] ? `<p style="margin-top:6px;font-size:.85rem;color:var(--muted)">${escapeHTML(STATUS_HINT[order.status])}</p>` : ""}
      </div>`;
  }

  function promptCustomerSignIn() {
    S.toast("Sign in with your customer account to track an order.", "error");
    closeModal("trackModal");
    setAuthMode("signin", "customer");
    openModal("authModal");
  }

  async function lookupOrder(reference) {
    const container = $("#trackResult");
    if (!currentUser) { promptCustomerSignIn(); return; }
    if (!reference) { container.textContent = "Enter your order reference."; return; }
    container.textContent = "Looking up your order…";
    try {
      const order = await S.getOrder(reference);
      container.innerHTML = order
        ? orderCardHTML(order)
        : "No order found. Check the reference and make sure you are signed in to the account that placed it.";
    } catch (err) {
      console.error("Could not track order:", err);
      container.textContent = S.friendlyError(err) || "Could not look up this order.";
    }
  }

  async function handleOrderTracking(e) {
    e.preventDefault();
    await lookupOrder($("#trackInput").value.trim());
  }

  async function loadMyOrders() {
    const list = $("#myOrdersList");
    if (!currentUser) {
      list.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Sign in to see all your orders here.</p>';
      return;
    }
    list.textContent = "Loading…";
    try {
      const orders = await S.getMyOrders();
      if (!orders.length) {
        list.innerHTML = '<p style="color:var(--muted);font-size:.9rem">No orders yet on this account.</p>';
        return;
      }
      list.innerHTML = orders.map((order) => `
        <button type="button" data-order-ref="${escapeHTML(order.reference)}" style="display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;text-align:left;padding:10px 12px;margin-bottom:8px;border:1px solid var(--line);border-radius:10px;background:#fff">
          <span><strong>${escapeHTML(order.reference)}</strong><br><small style="color:var(--muted)">${escapeHTML(new Date(order.created_at).toLocaleDateString())} · ${S.formatPrice(order.total)}</small></span>
          <span class="status-pill status-${escapeHTML(order.status)}">${escapeHTML(order.status)}</span>
        </button>`).join("");
      $$("[data-order-ref]", list).forEach((button) =>
        button.addEventListener("click", () => {
          $("#trackInput").value = button.dataset.orderRef;
          lookupOrder(button.dataset.orderRef);
        })
      );
    } catch (err) {
      console.error("Could not load orders:", err);
      list.textContent = S.friendlyError(err) || "Could not load your orders.";
    }
  }

  function openTrackModal(prefillReference = "") {
    $("#trackResult").innerHTML = "";
    $("#trackInput").value = prefillReference;
    openModal("trackModal");
    loadMyOrders();
    if (prefillReference) lookupOrder(prefillReference);
  }

  function showOrderSuccess(order, whatsappUrl) {
    $("#successRef").textContent = order.reference;
    $("#btnSuccessWhatsApp").href = whatsappUrl;
    $("#btnCopyRef").textContent = "📋 Copy reference";
    $("#btnCopyRef").dataset.ref = order.reference;
    $("#btnSuccessTrack").dataset.ref = order.reference;
    openModal("orderSuccessModal");
  }

  async function copyReference() {
    const ref = $("#btnCopyRef").dataset.ref || "";
    try {
      await navigator.clipboard.writeText(ref);
      $("#btnCopyRef").textContent = "✅ Copied!";
    } catch (err) {
      console.warn("Clipboard unavailable:", err);
      const range = document.createRange();
      range.selectNodeContents($("#successRef"));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      S.toast("Press and hold the reference to copy it.", "info", 4000);
    }
  }

  function openDrawer(id) {
    $("#" + id).classList.add("open");
    $("#overlay").classList.add("open");
  }

  function closeDrawer(id) {
    $("#" + id).classList.remove("open");
    if (!$$(".drawer.open, .modal.open").length) $("#overlay").classList.remove("open");
  }

  function openModal(id) {
    $("#" + id).classList.add("open");
    $("#overlay").classList.add("open");
  }

  function closeModal(id) {
    $("#" + id).classList.remove("open");
    if (!$$(".drawer.open, .modal.open").length) $("#overlay").classList.remove("open");
  }

  function closeAll() {
    $$(".drawer.open, .modal.open").forEach((element) => element.classList.remove("open"));
    $("#overlay").classList.remove("open");
  }

  function openSellerAuthModal() {
    $("#gatewayModal").classList.remove("open");
    setAuthMode("signup", "seller");
    openModal("authModal");
  }

  function setAuthMode(mode, role) {
    authMode = mode;
    authRole = role;
    const isSignUp = mode === "signup";
    $("#authToggleLink").textContent = isSignUp ? "Sign in" : "Sign up";
    $("#signUpFields").classList.toggle("hidden", !isSignUp);
    $("#authName").required = isSignUp;
    $("#authPhone").required = isSignUp;
    $("#authCallLine").required = isSignUp;
    $("#identifierLabel").textContent = isSignUp ? "Email address (optional)" : "Email address or WhatsApp number *";
    $("#authEmailInput").required = !isSignUp;
    $("#authEmailInput").type = isSignUp ? "email" : "text";
    $("#authEmailInput").placeholder = isSignUp ? "Optional email address" : "Enter your email or WhatsApp number";
    $("#authTitle").textContent = isSignUp
      ? role === "seller" ? "Seller Account Registration" : "Create Customer Account"
      : role === "seller" ? "Seller Sign in" : "Customer Sign in";
    $("#authToggleText").textContent = isSignUp ? "Already have an account?" : "Don't have an account?";
    $("#authRole").value = role;
    $("#authSubmitBtn").textContent = isSignUp
      ? role === "seller" ? "Register as Seller" : "Create Account"
      : "Sign in";
    $("#authPassword").autocomplete = isSignUp ? "new-password" : "current-password";
  }

  function wireEvents() {
    // Gateway choices
    $("#btnGatewayBuyer").addEventListener("click", () => {
      $("#gatewayModal").classList.remove("open");
      $("#overlay").classList.remove("open");
    });
$("#btnDrawerCart").addEventListener("click", () => {
  closeDrawer("mobileDrawer");
  openCart();
});


    $("#btnGatewaySeller").addEventListener("click", () => {
      window.location.href = "management-seller.html";
    });

    // Seller Prompts
    $("#btnBannerSellerSignUp").addEventListener("click", () => {
      dismissSellerBanner();
      openSellerAuthModal();
    });
    $("#btnDismissSellerBanner").addEventListener("click", dismissSellerBanner);
    $("#btnSellerSignupPrompt").addEventListener("click", () => {
      closeDrawer("mobileDrawer");
      openSellerAuthModal();
    });

    // Tracking
    $("#btnTrackOrder").addEventListener("click", () => openTrackModal());
    $("#btnDrawerTrack").addEventListener("click", () => {
      closeDrawer("mobileDrawer");
      openTrackModal();
    });
    $("#btnRefreshOrders").addEventListener("click", loadMyOrders);
    $("#btnCopyRef").addEventListener("click", copyReference);
    $("#btnSuccessTrack").addEventListener("click", () => {
      const ref = $("#btnSuccessTrack").dataset.ref || "";
      closeModal("orderSuccessModal");
      openTrackModal(ref);
    });
    $("#btnDrawerSellerDashboard").addEventListener("click", () => {
      window.location.href = "management-seller.html";
    });
    $("#btnDrawerAdmin").addEventListener("click", () => {
      window.location.href = "admin.html";
    });
    $("#trackForm").addEventListener("submit", handleOrderTracking);

    $("#btnAuth").addEventListener("click", async () => {
      closeDrawer("mobileDrawer");
      if (currentUser) {
        if (confirm(`Logged in as ${currentUser.profile?.full_name || currentUser.email}. Log out?`)) {
          try {
            await S.signOut();
            location.reload();
          } catch (err) {
            S.toast(err.message || "Could not sign out.", "error");
          }
        }
      } else {
        setAuthMode("signin", "customer");
        openModal("authModal");
      }
    });

    $("#authToggleLink").addEventListener("click", (e) => {
      e.preventDefault();
      setAuthMode(authMode === "signup" ? "signin" : "signup", authRole);
    });

    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      let identifier = $("#authEmailInput").value.trim();
      const pass = $("#authPassword").value;
      const role = authRole;
      const submitButton = $("#authSubmitBtn");
      submitButton.disabled = true;

      try {
        if (authMode === "signup") {
          const name = $("#authName").value.trim();
          const phone = $("#authPhone").value.replace(/[^0-9]/g, "");
          const callLine = $("#authCallLine").value.replace(/[^0-9]/g, "");
          if (!phone || !callLine) throw new Error("Enter valid WhatsApp and call line numbers.");
          const secondaryEmail = identifier;
          identifier = role === "seller" || !identifier
            ? S.phoneToEmail(phone)
            : identifier;
          const result = await S.signUp(
            identifier,
            pass,
            name,
            phone,
            role,
            callLine,
            role === "seller" ? secondaryEmail : ""
          );
          if (!result.session) {
            closeAll();
            S.toast("Account created. Verify your email before signing in.", "info", 8000);
            return;
          }
          currentUser = await S.getCurrentUser();
          if (role === "seller") {
            S.toast("Seller account created! It is pending moderator approval.", "info", 8000);
            location.href = "management-seller.html";
            return;
          }
          S.toast("Customer account created!");
          updateAuthUI();
          closeAll();
        } else {
          if (!identifier.includes("@")) {
            if (!identifier.replace(/[^0-9]/g, "")) throw new Error("Enter a valid WhatsApp number or email address.");
            identifier = S.phoneToEmail(identifier);
          }
          await S.signIn(identifier, pass);
          currentUser = await S.getCurrentUser();
          if (currentUser.profile.role === "seller") {
            location.href = "management-seller.html";
            return;
          }
          if (currentUser.profile.role === "moderator") {
            location.href = "admin.html";
            return;
          }
          S.toast("Welcome back! 🎉");
          updateAuthUI();
          closeAll();
        }
      } catch (err) {
        console.error("Auth failed:", err);
        S.toast(S.friendlyError(err), "error", 6000);
      } finally {
        submitButton.disabled = false;
      }
    });

    $$("[data-close-modal]").forEach(b => b.addEventListener("click", () => closeModal(b.dataset.closeModal)));
    $$("[data-close]").forEach((button) => button.addEventListener("click", () => closeDrawer(button.dataset.close)));
    $("#overlay").addEventListener("click", closeAll);
    $("#btnMenu").addEventListener("click", () => openDrawer("mobileDrawer"));

    const input = $("#searchInput");
    const runSearch = () => {
      state.search = input.value.trim();
      state.activeCategory = "All";
      renderProducts();
      if (state.search) scrollToProducts();
    };
    $("#searchBtn").addEventListener("click", runSearch);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

    $("#sortSel").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderProducts();
    });

    const currencySelect = $("#currencySel");
    if (currencySelect) {
      currencySelect.addEventListener("change", (event) => {
        try {
          S.setCurrency(event.target.value);
          renderProducts();
          renderCart();
        } catch (err) {
          S.toast(err.message, "error");
        }
      });
    }

    $("#btnCart").addEventListener("click", openCart);
    $("#checkoutForm").addEventListener("submit", submitWhatsAppOrder);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
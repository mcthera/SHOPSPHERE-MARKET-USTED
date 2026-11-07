(function () {
  "use strict";
  const S = window.Store;
  const supabase = S.supabase;
  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const whatsappNumber = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("0")) return `233${digits.slice(1)}`;
    return digits;
  };

  let allProducts = [];
  let allProfiles = [];
  let allOrders = [];
  let allBanners = [];
  let allResets = [];
  let maxBanners = 4;
  let currentModerator = null;
  let wired = false;

  async function initAuth() {
    $("#loginForm").addEventListener("submit", signInModerator);
    try {
      const user = await S.getCurrentUser();
      if (user?.profile?.role === "moderator") {
        currentModerator = user;
        await unlock();
        return;
      }
    } catch (err) {
      console.error("Could not restore moderator session:", err);
      S.toast(err.message || "Could not verify the moderator session.", "error");
    }
    $("#loginGate").classList.remove("hidden");
  }

  async function signInModerator(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      let identifier = $("#moderatorEmail").value.trim();
      if (!identifier.includes("@")) {
        if (!identifier.replace(/[^0-9]/g, "")) throw new Error("Enter a valid WhatsApp number or email address.");
        identifier = S.phoneToEmail(identifier);
      }
      await S.signIn(identifier, $("#moderatorPassword").value);
      const user = await S.getCurrentUser();
      if (user.profile.role !== "moderator") {
        await S.signOut();
        throw new Error("This Supabase account does not have the moderator role.");
      }
      currentModerator = user;
      await unlock();
      S.toast("Welcome, Moderator.");
    } catch (err) {
      console.error("Moderator sign-in failed:", err);
      S.toast(S.friendlyError(err) || "Moderator sign-in failed.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function unlock() {
    $("#loginGate").classList.add("hidden");
    $("#adminShell").classList.remove("hidden");
    if (!wired) {
      wireEvents();
      wired = true;
    }
    await loadPlatformData();
  }

  function switchView(view) {
    $$(".admin-nav [data-view]").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view)
    );
    ["dashboard", "products", "orders", "users", "banners", "resets"].forEach((name) =>
      $("#view-" + name).classList.toggle("hidden", name !== view)
    );
    $("#viewTitle").textContent = {
      dashboard: "Moderator Overview",
      products: "All Platform Products",
      orders: "Platform Orders",
      users: "Registered Sellers & Users",
      banners: "Homepage Ad Banners",
      resets: "Password Reset Requests",
    }[view] || "Moderator Overview";
    $("#adminSide").classList.remove("open");
    $("#overlay").classList.remove("open");
  }

  async function loadPlatformData() {
    const results = await Promise.allSettled([
      S.getProducts(),
      supabase.from("profiles").select("id, full_name, email, phone_whatsapp, phone_call, role, seller_status, verified, created_at").order("created_at", { ascending: false }),
      supabase.from("orders").select("id, reference, customer_name, customer_phone, customer_address, class_name, index_number, items, total, status, created_at").order("created_at", { ascending: false }),
    ]);
    const problems = [];
    const [productsRes, profilesRes, ordersRes] = results;
    if (productsRes.status === "fulfilled") allProducts = productsRes.value;
    else problems.push(`products: ${productsRes.reason?.message || productsRes.reason}`);
    if (profilesRes.status === "fulfilled" && !profilesRes.value.error) allProfiles = profilesRes.value.data || [];
    else problems.push(`accounts: ${profilesRes.reason?.message || profilesRes.value?.error?.message}`);
    if (ordersRes.status === "fulfilled" && !ordersRes.value.error) allOrders = ordersRes.value.data || [];
    else problems.push(`orders: ${ordersRes.reason?.message || ordersRes.value?.error?.message}`);
    if (problems.length) {
      console.error("Moderator data problems:", problems);
      S.toast(`Some data could not load (${problems.join("; ")}). Run supabase-setup.sql if you haven't.`, "error", 9000);
    }
    await loadBanners();
    await loadResets();
    renderModeratorDashboard();
    renderAllProductsTable();
    renderUsersTable();
    renderOrdersTable();
    populateProductFormOptions();
  }

  function renderModeratorDashboard() {
    const pendingSellers = allProfiles.filter((profile) =>
      profile.role === "seller" && profile.seller_status !== "approved"
    ).length;
    $("#statCards").innerHTML = `
      <div class="stat stat--prod"><div class="stat__icon"><i class="bi bi-box-seam-fill" aria-hidden="true"></i></div>
        <div class="stat__label">Total Listings</div><div class="stat__value">${allProducts.length}</div></div>
      <div class="stat stat--sales"><div class="stat__icon"><i class="bi bi-people-fill" aria-hidden="true"></i></div>
        <div class="stat__label">Registered Accounts</div><div class="stat__value">${allProfiles.length}</div></div>
      <div class="stat stat--ord"><div class="stat__icon"><i class="bi bi-clock-fill" aria-hidden="true"></i></div>
        <div class="stat__label">Pending Sellers</div><div class="stat__value">${pendingSellers}</div></div>
      <div class="stat stat--sales"><div class="stat__icon"><i class="bi bi-receipt" aria-hidden="true"></i></div>
        <div class="stat__label">Platform Orders</div><div class="stat__value">${allOrders.length}</div></div>`;

    const recent = allProducts.slice(0, 5);
    $("#recentOrders").innerHTML = recent.length
      ? `<thead><tr><th>Image</th><th>Item Title</th><th>Seller</th><th>Price</th></tr></thead><tbody>${recent
          .map((product) => `<tr>
            <td>${product.images?.[0] ? `<img src="${escapeHTML(product.images[0])}" alt="">` : "—"}</td>
            <td><strong>${escapeHTML(product.title)}</strong></td>
            <td>${escapeHTML(product.seller_name || "Unknown")}</td>
            <td>${S.formatPrice(product.price)}</td>
          </tr>`).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">No products posted yet.</td></tr></tbody>`;

    const sellers = allProfiles.filter((profile) => profile.role === "seller");
    $("#lowStockTable").innerHTML = sellers.length
      ? `<thead><tr><th>Seller</th><th>WhatsApp Phone</th><th>Status</th></tr></thead><tbody>${sellers
          .map((profile) => {
            const status = profile.seller_status || "pending";
            return `<tr>
              <td><strong>${escapeHTML(profile.full_name || "Unnamed seller")}</strong>${profile.verified ? ' <span class="verified-badge"><i class="bi bi-patch-check-fill" aria-hidden="true"></i> Campus Verified</span>' : ""}</td>
              <td>${escapeHTML(profile.phone_whatsapp || "—")}</td>
              <td><span class="badge ${status === "approved" ? "badge--cat" : "badge--low"}">${escapeHTML(status)}</span></td>
            </tr>`;
          }).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">No seller accounts found.</td></tr></tbody>`;
  }

  function renderAllProductsTable() {
    const table = $("#productsTable");
    if (!allProducts.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">No products on the platform.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Image</th><th>Title</th><th>Seller</th><th>Category</th><th>Price</th><th>Stock</th><th>Featured</th><th>Last Updated</th><th>Actions</th></tr></thead>
      <tbody>${allProducts.map((product) => `<tr>
        <td>${product.images?.[0] ? `<img src="${escapeHTML(product.images[0])}" alt="">` : "—"}</td>
        <td><strong>${escapeHTML(product.title)}</strong></td>
        <td>${escapeHTML(product.seller_name || "Unknown")}</td>
        <td>${escapeHTML(product.category || "—")}</td>
        <td>${S.formatPrice(product.price)}</td>
        <td>${escapeHTML(product.stock)}</td>
        <td style="white-space:nowrap">
          ${product.isFeatured ? `<span class="badge badge--cat"><i class="bi bi-star-fill" aria-hidden="true"></i> until ${escapeHTML(new Date(product.featuredUntil).toLocaleDateString())}</span><br>` : ""}
          <button class="btn btn--ghost btn--sm" data-feature-id="${escapeHTML(product.id)}" data-feature-days="7">+7 days</button>
          <button class="btn btn--ghost btn--sm" data-feature-id="${escapeHTML(product.id)}" data-feature-days="30">+30</button>
          ${product.isFeatured ? `<button class="btn btn--ghost btn--sm" data-feature-id="${escapeHTML(product.id)}" data-feature-days="0" style="color:#b00020">Remove</button>` : ""}
        </td>
        <td>${product.last_updated_at ? escapeHTML(new Date(product.last_updated_at).toLocaleString()) : "—"}</td>
        <td><button class="btn btn--ghost btn--sm" data-mod-edit="${escapeHTML(product.id)}"><i class="bi bi-pencil-fill" aria-hidden="true"></i> Edit</button> <button class="btn btn--danger btn--sm" data-mod-del="${escapeHTML(product.id)}"><i class="bi bi-trash-fill" aria-hidden="true"></i> Take Down</button></td>
      </tr>`).join("")}</tbody>`;
    $$("[data-mod-edit]", table).forEach((button) =>
      button.addEventListener("click", () => openProductEditor(button.dataset.modEdit))
    );
    $$("[data-feature-id]", table).forEach((button) =>
      button.addEventListener("click", () => setFeatured(button, button.dataset.featureId, Number(button.dataset.featureDays)))
    );
    $$("[data-mod-del]", table).forEach((button) =>
      button.addEventListener("click", () => moderatorDeleteProduct(button.dataset.modDel))
    );
  }

  function renderUsersTable() {
    const sellers = allProfiles.filter((profile) => profile.role === "seller");
    const customers = allProfiles.filter((profile) =>
      profile.role === "customer" && (profile.full_name || profile.phone_whatsapp || profile.email));
    const activeProductCounts = allProducts.reduce((counts, product) => {
      if (Number(product.stock) > 0) {
        counts[product.seller_id] = (counts[product.seller_id] || 0) + 1;
      }
      return counts;
    }, {});
    const sellerTable = $("#sellerAccountsTable");
    const customerTable = $("#customerAccountsTable");
    sellerTable.innerHTML = sellers.length
      ? `<thead><tr><th>Full Name</th><th>Email</th><th>WhatsApp</th><th>Call Line</th><th>Signed Up</th><th>Status</th><th>Active Listings</th><th>Contact / Action</th></tr></thead>
        <tbody>${sellers.map((profile) => {
          const isPending = profile.seller_status !== "approved";
          const phone = whatsappNumber(profile.phone_whatsapp);
          const whatsapp = phone
            ? `<a class="btn btn--ghost btn--sm" href="https://wa.me/${encodeURIComponent(phone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`
            : "—";
          return `<tr>
            <td><strong>${escapeHTML(profile.full_name || "Unnamed seller")}</strong></td>
            <td>${escapeHTML(profile.email || "—")}</td>
            <td>${escapeHTML(profile.phone_whatsapp || "—")}</td>
            <td>${escapeHTML(profile.phone_call || "—")}</td>
            <td>${profile.created_at ? escapeHTML(new Date(profile.created_at).toLocaleDateString()) : "—"}</td>
            <td><span class="badge ${isPending ? "badge--low" : "badge--cat"}">${escapeHTML(profile.seller_status || "pending")}</span></td>
            <td>${activeProductCounts[profile.id] || 0}</td>
            <td>${whatsapp} ${isPending
              ? `<button class="btn btn--green btn--sm" data-approve-id="${escapeHTML(profile.id)}"><i class="bi bi-check-circle-fill" aria-hidden="true"></i> Approve</button>`
              : `<button class="btn btn--ghost btn--sm" data-suspend-id="${escapeHTML(profile.id)}"><i class="bi bi-pause-circle-fill" aria-hidden="true"></i> Suspend</button>`}
              <button class="btn btn--ghost btn--sm" data-verify-id="${escapeHTML(profile.id)}" data-verify-to="${profile.verified ? "false" : "true"}"><i class="bi bi-patch-check-fill" aria-hidden="true"></i> ${profile.verified ? "Remove Campus Verified" : "Make Campus Verified"}</button></td>
          </tr>`;
        }).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">No seller accounts found.</td></tr></tbody>`;
    customerTable.innerHTML = customers.length
      ? `<thead><tr><th>Full Name</th><th>WhatsApp</th><th>Call Line</th><th>Email</th><th>Signed Up</th></tr></thead>
        <tbody>${customers.map((profile) => `<tr>
          <td><strong>${escapeHTML(profile.full_name || "Unnamed customer")}</strong></td>
          <td>${escapeHTML(profile.phone_whatsapp || "—")}</td>
          <td>${escapeHTML(profile.phone_call || "—")}</td>
          <td>${escapeHTML(profile.email || "—")}</td>
          <td>${profile.created_at ? escapeHTML(new Date(profile.created_at).toLocaleDateString()) : "—"}</td>
        </tr>`).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">No customer accounts found.</td></tr></tbody>`;
    $$("[data-approve-id]", sellerTable).forEach((button) =>
      button.addEventListener("click", () => setSellerStatus(button, button.dataset.approveId, "approved"))
    );
    $$("[data-verify-id]", sellerTable).forEach((button) =>
      button.addEventListener("click", () => setSellerVerified(button, button.dataset.verifyId, button.dataset.verifyTo === "true"))
    );
    $$("[data-suspend-id]", sellerTable).forEach((button) =>
      button.addEventListener("click", () => {
        if (confirm("Suspend this seller? They won't be able to post or edit listings.")) {
          setSellerStatus(button, button.dataset.suspendId, "suspended");
        }
      })
    );
  }

  function switchAccountTab(tab) {
    const showSellers = tab === "sellers";
    $("#sellerAccountsPanel").classList.toggle("hidden", !showSellers);
    $("#customerAccountsPanel").classList.toggle("hidden", showSellers);
    $$("[data-account-tab]").forEach((button) => {
      const active = button.dataset.accountTab === tab;
      button.classList.toggle("btn--primary", active);
      button.classList.toggle("btn--ghost", !active);
    });
  }

  function populateProductFormOptions(selectedSellerId = "") {
    const sellers = allProfiles.filter((profile) =>
      profile.role === "seller"
      && (profile.seller_status === "approved" || profile.id === selectedSellerId)
    );
    const categorySelect = $("#pCategory");
    const sellerSelect = $("#pSeller");
    categorySelect.innerHTML = S.CATEGORIES
      .map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`)
      .join("");
    sellerSelect.innerHTML = `<option value="">Select an approved seller</option>${sellers
      .map((profile) => {
        const status = profile.seller_status || "pending";
        const label = `${profile.full_name || "Unnamed seller"}${status === "approved" ? "" : ` (${status})`}`;
        return `<option value="${escapeHTML(profile.id)}">${escapeHTML(label)}</option>`;
      }).join("")}`;
    if (selectedSellerId) sellerSelect.value = selectedSellerId;
  }

  function openProductEditor(productId = "") {
    const product = allProducts.find((item) => item.id === productId);
    const form = $("#productForm");
    form.reset();
    $("#pId").value = product?.id || "";
    $("#productModalTitle").textContent = product ? "Edit Listing" : "Add Listing";
    $("#btnSaveProduct").textContent = product ? "Save Changes" : "Create Listing";
    populateProductFormOptions(product?.seller_id || "");
    $("#pTitle").value = product?.title || "";
    $("#pCategory").value = product?.category || S.CATEGORIES[0];
    $("#pPrice").value = product?.price ?? "";
    $("#pDiscount").value = product?.discount_price ?? 0;
    $("#pStock").value = product?.stock ?? 1;
    $("#pDescription").value = product?.description || "";
    $("#pSpecs").value = product?.specs || "";
    $("#pImages").value = "";
    $("#pImagePreview").innerHTML = (product?.images || [])
      .map((url) => `<img src="${escapeHTML(url)}" alt="Current product image">`)
      .join("");
    $("#pImageHelp").textContent = product
      ? "Choose replacement images, or leave blank to keep current images."
      : "Choose one or more images for this listing.";
    $("#productModal").classList.add("open");
    $("#overlay").classList.add("open");
  }

  const uploadModeratorImages = (files) => S.uploadImages(files, currentModerator.id);

  async function saveProduct(event) {
    event.preventDefault();
    const button = $("#btnSaveProduct");
    const id = $("#pId").value;
    const seller = allProfiles.find((profile) => profile.id === $("#pSeller").value);
    const files = [...$("#pImages").files];
    const price = Number($("#pPrice").value);
    const discountPrice = Number($("#pDiscount").value || 0);
    const stock = Number($("#pStock").value);
    if (!seller || seller.role !== "seller" || (!id && seller.seller_status !== "approved")) {
      S.toast("Choose an approved seller for this listing.", "error");
      return;
    }
    if (!$("#pTitle").value.trim()) {
      S.toast("Enter a listing title.", "error");
      return;
    }
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(discountPrice) || discountPrice < 0
      || !Number.isInteger(stock) || stock < 0) {
      S.toast("Enter valid price, discount, and stock values.", "error");
      return;
    }
    button.disabled = true;
    try {
      const currentProduct = allProducts.find((product) => product.id === id);
      const images = files.length ? await uploadModeratorImages(files) : currentProduct?.images || [];
      if (!id && !images.length) throw new Error("Choose at least one product photo.");
      const productData = {
        seller_id: seller.id,
        seller_name: seller.full_name || "Verified Seller",
        seller_phone: seller.phone_whatsapp || "",
        title: $("#pTitle").value.trim(),
        category: $("#pCategory").value,
        price,
        discount_price: discountPrice,
        stock,
        description: $("#pDescription").value.trim(),
        specs: $("#pSpecs").value.trim(),
        images,
      };
      if (id) {
        const { data, error } = await supabase
          .from("products")
          .update(productData)
          .eq("id", id)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("The listing was not updated.");
      } else {
        const { error } = await supabase.from("products").insert(productData);
        if (error) throw error;
      }
      $("#productModal").classList.remove("open");
      $("#overlay").classList.remove("open");
      S.toast(id ? "Listing updated." : "Listing created.");
      await loadPlatformData();
    } catch (err) {
      console.error("Could not save moderator listing:", err);
      S.toast(err.message || "Could not save the listing.", "error", 7000);
    } finally {
      button.disabled = false;
    }
  }

  function renderOrdersTable() {
    const table = $("#platformOrdersTable");
    const query = $("#ordersFilter").value.trim().toLowerCase();
    const orders = allOrders.filter((order) => [
      order.reference, order.customer_name, order.customer_phone, order.status,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
    if (!orders.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">${query ? "No orders match your search." : "No platform orders yet."}</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Reference</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${orders.map((order) => `<tr>
        <td><strong>${escapeHTML(order.reference)}</strong></td>
        <td>${escapeHTML(order.customer_name || "Customer")}<br><small>${escapeHTML(order.customer_phone || "")}</small></td>
        <td>${escapeHTML(new Date(order.created_at).toLocaleString())}</td>
        <td>${S.formatPrice(order.total)}</td>
        <td><select data-order-status="${escapeHTML(order.id)}"${order.status === "Canceled" ? " disabled" : ""} aria-label="Update status for ${escapeHTML(order.reference)}">
          ${["Pending", "Shipped", "Delivered", "Canceled"].map((status) =>
            `<option value="${status}"${order.status === status ? " selected" : ""}>${status}</option>`
          ).join("")}</select></td>
        <td><button class="btn btn--ghost btn--sm" data-order-details="${escapeHTML(order.id)}">Details</button></td>
      </tr>`).join("")}</tbody>`;
    $$("[data-order-status]", table).forEach((select) =>
      select.addEventListener("change", () => updatePlatformOrderStatus(select))
    );
    $$("[data-order-details]", table).forEach((button) =>
      button.addEventListener("click", () => showOrderDetails(button.dataset.orderDetails))
    );
  }

  function showOrderDetails(orderId) {
    const order = allOrders.find((item) => item.id === orderId);
    if (!order) return;
    $("#orderModalBody").innerHTML = `
      <p><strong>Reference:</strong> ${escapeHTML(order.reference)}</p>
      <p><strong>Status:</strong> ${escapeHTML(order.status)}</p>
      <p><strong>Placed:</strong> ${escapeHTML(new Date(order.created_at).toLocaleString())}</p>
      <hr style="margin:12px 0;border:none;border-top:1px solid var(--line)">
      <p><strong>Customer:</strong> ${escapeHTML(order.customer_name)}</p>
      <p><strong>Phone:</strong> ${escapeHTML(order.customer_phone)}</p>
      <p><strong>Delivery location:</strong> ${escapeHTML(order.customer_address)}</p>
      <p><strong>Class:</strong> ${escapeHTML(order.class_name)}</p>
      <p><strong>Index number:</strong> ${escapeHTML(order.index_number || "Not provided")}</p>
      <h4 style="margin-top:14px">Items</h4>
      ${(order.items || []).map((item) => `<p>${escapeHTML(item.title)} (x${escapeHTML(item.qty)}) — ${S.formatPrice(Number(item.price) * Number(item.qty))}</p>`).join("")}
      <hr style="margin:12px 0;border:none;border-top:1px solid var(--line)">
      <p><strong>Total:</strong> ${S.formatPrice(order.total)}</p>`;
    $("#orderModal").classList.add("open");
    $("#overlay").classList.add("open");
  }

  async function updatePlatformOrderStatus(select) {
    const order = allOrders.find((item) => item.id === select.dataset.orderStatus);
    if (!order) return;
    const previousStatus = order.status;
    if (select.value === "Canceled" && !confirm("Cancel this order? The items go back into stock and a canceled order cannot be changed again.")) {
      select.value = previousStatus;
      return;
    }
    select.disabled = true;
    try {
      await S.updateOrderStatus(order.id, select.value);
      const canceled = select.value === "Canceled";
      order.status = select.value;
      S.toast(canceled ? "Order canceled and stock restored." : "Order status updated.");
      if (canceled) await loadPlatformData();
    } catch (err) {
      console.error("Could not update platform order:", err);
      select.value = previousStatus;
      S.toast(err.message || "Could not update order status.", "error");
    } finally {
      select.disabled = false;
    }
  }

  async function setFeatured(button, productId, days) {
    const product = allProducts.find((item) => item.id === productId);
    if (!product) return;
    button.disabled = true;
    try {
      // extending adds to whatever time is left, so paying twice never loses days
      const base = Math.max(Date.now(), product.isFeatured ? product.featuredUntil : 0);
      const until = days > 0 ? new Date(base + days * 86400000).toISOString() : null;
      const { data, error } = await supabase.from("products").update({ featured_until: until }).eq("id", productId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Not updated. Check your moderator role and that supabase-featured.sql was run.");
      S.toast(days > 0 ? `Featured for ${days} more days.` : "Featured status removed.");
      await loadPlatformData();
    } catch (err) {
      console.error("Could not update featured status:", err);
      S.toast(err.message || "Could not update featured status.", "error", 7000);
      button.disabled = false;
    }
  }

  async function setSellerVerified(button, sellerId, verified) {
    button.disabled = true;
    try {
      const { data, error } = await supabase.from("profiles").update({ verified }).eq("id", sellerId).eq("role", "seller").select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Not updated. Check your moderator role and that supabase-featured.sql was run.");
      S.toast(verified ? "Seller is now Campus Verified" : "Campus Verified badge removed.");
      await loadPlatformData();
    } catch (err) {
      console.error("Could not update Campus Verified badge:", err);
      S.toast(err.message || "Could not update the Campus Verified badge.", "error", 7000);
      button.disabled = false;
    }
  }

  async function saveMaxBanners() {
    const value = Number.parseInt($("#bnMax").value, 10);
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      S.toast("Enter a whole number from 1 to 20.", "error");
      return;
    }
    const button = $("#btnSaveMax");
    button.disabled = true;
    try {
      const { error } = await supabase.from("site_settings").upsert({ key: "max_banners", value: String(value), updated_at: new Date().toISOString() });
      if (error) throw error;
      maxBanners = value;
      S.toast(`Homepage will show at most ${value} ad${value === 1 ? "" : "s"}.`);
      renderBannersTable();
    } catch (err) {
      console.error("Could not save ad limit:", err);
      S.toast(`${err.message || "Could not save the limit."} (Run supabase-featured.sql if you haven't.)`, "error", 7000);
    } finally {
      button.disabled = false;
    }
  }

  async function setSellerStatus(button, sellerId, status) {
    button.disabled = true;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .update({ seller_status: status })
        .eq("id", sellerId)
        .eq("role", "seller")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Supabase did not update the seller. Check that your account has the moderator role and that supabase-setup.sql was run.");
      S.toast(status === "approved" ? "Seller account approved." : "Seller suspended.");
      await loadPlatformData();
    } catch (err) {
      console.error("Could not update seller status:", err);
      S.toast(err.message || "Could not update seller account.", "error", 7000);
    } finally {
      button.disabled = false;
    }
  }

  async function moderatorDeleteProduct(id) {
    if (!confirm("Are you sure you want to remove this product?")) return;
    try {
      await S.deleteProduct(id);
      S.toast("Product removed.");
      await loadPlatformData();
    } catch (err) {
      console.error("Moderator product removal failed:", err);
      S.toast(err.message || "Could not remove this product.", "error");
    }
  }

  // ---------- ad banners ----------
  async function loadBanners() {
    const { data, error } = await supabase
      .from("banners")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Could not load banners:", error);
      allBanners = [];
      renderBannersTable(`Could not load banners: ${error.message}. Run supabase-banners.sql in Supabase first.`);
      return;
    }
    allBanners = data || [];
    maxBanners = await S.getMaxBanners();
    $("#bnMax").value = maxBanners;
    renderBannersTable();
  }

  function bannerState(banner) {
    const now = Date.now();
    if (!banner.is_active) return { label: "Off", cls: "Canceled" };
    if (banner.starts_at && new Date(banner.starts_at).getTime() > now) return { label: "Scheduled", cls: "Pending" };
    if (banner.ends_at && new Date(banner.ends_at).getTime() < now) return { label: "Expired", cls: "Canceled" };
    return { label: "Live", cls: "Delivered" };
  }

  const fmtDate = (value) => (value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

  function renderBannersTable(message) {
    const table = $("#bannersTable");
    if (message || !allBanners.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">${escapeHTML(message || "No banners yet. Tap “New Banner” to create your first ad.")}</td></tr></tbody>`;
      return;
    }
    const liveIds = allBanners.filter((banner) => S.isBannerLive(banner)).map((banner) => banner.id);
    const shownIds = new Set(liveIds.slice(0, maxBanners));
    $("#bnMaxNote").textContent = liveIds.length > maxBanners
      ? `${liveIds.length} ads are live but only the first ${maxBanners} (by Order) are shown.`
      : `${liveIds.length} live ad${liveIds.length === 1 ? "" : "s"} · limit ${maxBanners}.`;
    table.innerHTML = `<thead><tr><th>Ad</th><th>Schedule</th><th>Status</th><th>Views</th><th>Clicks</th><th>CTR</th><th>Actions</th></tr></thead>
      <tbody>${allBanners.map((banner) => {
        const state = bannerState(banner);
        if (state.label === "Live" && !shownIds.has(banner.id)) { state.label = "Live · over limit"; state.cls = "Pending"; }
        const views = Number(banner.views || 0);
        const clicks = Number(banner.clicks || 0);
        const ctr = views ? `${((clicks / views) * 100).toFixed(1)}%` : "—";
        return `<tr>
          <td style="display:flex;gap:10px;align-items:center">
            ${banner.image_url ? `<img src="${escapeHTML(banner.image_url)}" alt="" style="width:84px;height:34px">` : ""}
            <span><strong>${escapeHTML(banner.advertiser)}</strong><br><small>${escapeHTML(banner.headline || "")}</small></span>
          </td>
          <td><small>${escapeHTML(fmtDate(banner.starts_at))}<br>→ ${escapeHTML(banner.ends_at ? fmtDate(banner.ends_at) : "no end")}</small></td>
          <td><span class="status-pill status-${state.cls}">${state.label}</span></td>
          <td>${views.toLocaleString()}</td>
          <td>${clicks.toLocaleString()}</td>
          <td>${ctr}</td>
          <td style="white-space:nowrap">
            <button class="btn btn--ghost btn--sm" data-banner-edit="${escapeHTML(banner.id)}">Edit</button>
            <button class="btn btn--ghost btn--sm" data-banner-toggle="${escapeHTML(banner.id)}">${banner.is_active ? "Turn off" : "Turn on"}</button>
            <button class="btn btn--ghost btn--sm" data-banner-delete="${escapeHTML(banner.id)}" style="color:#b00020">Delete</button>
          </td>
        </tr>`;
      }).join("")}</tbody>`;
    $$("[data-banner-edit]", table).forEach((b) => b.addEventListener("click", () => openBannerEditor(b.dataset.bannerEdit)));
    $$("[data-banner-toggle]", table).forEach((b) => b.addEventListener("click", () => toggleBanner(b)));
    $$("[data-banner-delete]", table).forEach((b) => b.addEventListener("click", () => deleteBanner(b)));
  }

  // <input type="datetime-local"> wants local time without a timezone
  function toLocalInput(value) {
    if (!value) return "";
    const date = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function openBannerEditor(id) {
    const banner = id ? allBanners.find((item) => item.id === id) : null;
    $("#bannerForm").reset();
    $("#bannerModalTitle").textContent = banner ? "Edit Banner" : "New Banner";
    $("#bnId").value = banner?.id || "";
    $("#bnAdvertiser").value = banner?.advertiser || "";
    $("#bnHeadline").value = banner?.headline || "";
    $("#bnSubtext").value = banner?.subtext || "";
    $("#bnButton").value = banner?.button_text || "Order now";
    $("#bnWhatsapp").value = banner?.whatsapp || "";
    $("#bnLink").value = banner?.link_url || "";
    $("#bnStart").value = toLocalInput(banner?.starts_at);
    $("#bnEnd").value = toLocalInput(banner?.ends_at);
    $("#bnOrder").value = banner?.sort_order ?? 0;
    $("#bnActive").checked = banner ? Boolean(banner.is_active) : true;
    $("#bnRemoveImage").checked = false;
    $("#bnImagePreview").innerHTML = banner?.image_url ? `<img src="${escapeHTML(banner.image_url)}" alt="Current banner image" style="width:160px;height:auto">` : "";
    $("#bannerModal").classList.add("open");
    $("#overlay").classList.add("open");
  }

  async function saveBanner(event) {
    event.preventDefault();
    const button = $("#btnSaveBanner");
    const id = $("#bnId").value;
    const existing = id ? allBanners.find((item) => item.id === id) : null;
    const whatsapp = $("#bnWhatsapp").value.replace(/[^0-9]/g, "");
    const link = $("#bnLink").value.trim();
    const file = $("#bnImage").files[0];
    const headline = $("#bnHeadline").value.trim();

    try {
      if (!whatsapp && !link) throw new Error("Add a WhatsApp number or a website link so people can reach the advertiser.");
      if (link && !/^https?:\/\//i.test(link)) throw new Error("The website link must start with http:// or https://");
      const start = $("#bnStart").value ? new Date($("#bnStart").value) : null;
      const end = $("#bnEnd").value ? new Date($("#bnEnd").value) : null;
      if (start && end && end <= start) throw new Error("The end date must be after the start date.");
      if (!file && !existing?.image_url && !headline) throw new Error("Add an image or a headline, otherwise the banner would be empty.");

      button.disabled = true;
      button.textContent = "Saving…";
      let imageUrl = $("#bnRemoveImage").checked ? null : existing?.image_url || null;
      if (file) imageUrl = (await S.uploadImages([file], "banners"))[0];

      const payload = {
        advertiser: $("#bnAdvertiser").value.trim(),
        headline: headline || null,
        subtext: $("#bnSubtext").value.trim() || null,
        button_text: $("#bnButton").value.trim() || "Learn more",
        image_url: imageUrl,
        whatsapp: whatsapp || null,
        link_url: link || null,
        starts_at: start ? start.toISOString() : null,
        ends_at: end ? end.toISOString() : null,
        sort_order: Number.parseInt($("#bnOrder").value, 10) || 0,
        is_active: $("#bnActive").checked,
      };
      const query = id
        ? supabase.from("banners").update(payload).eq("id", id)
        : supabase.from("banners").insert(payload);
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The banner was not saved. Check that your account has the moderator role.");
      S.toast(id ? "Banner updated." : "Banner created.");
      $("#bannerModal").classList.remove("open");
      if (!$(".modal.open")) $("#overlay").classList.remove("open");
      await loadBanners();
    } catch (err) {
      console.error("Could not save banner:", err);
      S.toast(err.message || "Could not save the banner.", "error", 7000);
    } finally {
      button.disabled = false;
      button.textContent = "Save Banner";
    }
  }

  async function toggleBanner(button) {
    const banner = allBanners.find((item) => item.id === button.dataset.bannerToggle);
    if (!banner) return;
    button.disabled = true;
    try {
      const { data, error } = await supabase
        .from("banners").update({ is_active: !banner.is_active }).eq("id", banner.id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The banner was not updated. Check your moderator role.");
      S.toast(banner.is_active ? "Banner turned off." : "Banner turned on.");
      await loadBanners();
    } catch (err) {
      console.error("Could not toggle banner:", err);
      S.toast(err.message || "Could not update the banner.", "error");
      button.disabled = false;
    }
  }

  async function deleteBanner(button) {
    const banner = allBanners.find((item) => item.id === button.dataset.bannerDelete);
    if (!banner || !confirm(`Delete the banner for “${banner.advertiser}”? Its view and click counts will be lost. (Use “Turn off” to keep the stats.)`)) return;
    button.disabled = true;
    try {
      const { data, error } = await supabase.from("banners").delete().eq("id", banner.id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The banner was not deleted. Check your moderator role.");
      S.toast("Banner deleted.");
      await loadBanners();
    } catch (err) {
      console.error("Could not delete banner:", err);
      S.toast(err.message || "Could not delete the banner.", "error");
      button.disabled = false;
    }
  }

  // ---------- password reset requests ----------
  async function loadResets() {
    const { data, error } = await supabase
      .from("password_reset_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.warn("Could not load password reset requests:", error.message);
      allResets = [];
      renderResets(`Could not load requests: ${error.message}. Run password-reset.sql in Supabase first.`);
      return;
    }
    allResets = data || [];
    renderResets();
  }

  function renderResets(message) {
    const openCount = allResets.filter((request) => request.status === "open").length;
    const navButton = $('.admin-nav [data-view="resets"]');
    if (navButton) navButton.innerHTML = `<i class="bi bi-key-fill" aria-hidden="true"></i> Password Resets${openCount ? ` (${openCount})` : ""}`;

    const table = $("#resetsTable");
    if (message || !allResets.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">${escapeHTML(message || "No password reset requests yet.")}</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Person</th><th>Account</th><th>WhatsApp</th><th>Asked</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${allResets.map((request) => {
        const profile = allProfiles.find((item) => item.id === request.user_id);
        const role = profile?.role || "—";
        const wa = S.whatsappNumber(request.phone);
        const cls = request.status === "open" ? "Pending" : request.status === "done" ? "Delivered" : "Canceled";
        let actions = "";
        if (request.status === "open") {
          actions = role === "moderator"
            ? `<small style="color:var(--muted)">Owner resets by hand (SQL)</small> `
            : `<button class="btn btn--green btn--sm" data-reset-id="${escapeHTML(request.id)}">Reset password</button> `;
          actions += `<button class="btn btn--ghost btn--sm" data-reset-dismiss="${escapeHTML(request.id)}">Dismiss</button>`;
        } else if (request.handled_at) {
          actions = `<small style="color:var(--muted)">${escapeHTML(new Date(request.handled_at).toLocaleString())}</small>`;
        }
        return `<tr>
          <td><strong>${escapeHTML(request.full_name || profile?.full_name || "Unnamed")}</strong></td>
          <td>${escapeHTML(role)}</td>
          <td>${wa ? `<a href="https://wa.me/${escapeHTML(wa)}" target="_blank" rel="noopener">${escapeHTML(request.phone || "")}</a>` : escapeHTML(request.phone || "—")}</td>
          <td><small>${escapeHTML(new Date(request.created_at).toLocaleString())}</small></td>
          <td><span class="status-pill status-${cls}">${escapeHTML(request.status)}</span></td>
          <td style="white-space:nowrap">${actions}</td>
        </tr>`;
      }).join("")}</tbody>`;
    $$("[data-reset-id]", table).forEach((button) => button.addEventListener("click", () => resetPassword(button)));
    $$("[data-reset-dismiss]", table).forEach((button) => button.addEventListener("click", () => dismissReset(button)));
  }

  async function resetPassword(button) {
    const request = allResets.find((item) => item.id === button.dataset.resetId);
    if (!request) return;
    const who = request.full_name || request.phone || "this person";
    if (!confirm(`Reset the password for ${who}?\n\nOnly continue if you have confirmed it is really them (for example by calling ${request.phone || "their number"}).`)) return;
    button.disabled = true;
    try {
      const { data, error } = await supabase.rpc('reset_user_password', { p_request_id: request.id });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "The reset did not work.");
      showTempPassword(data);
      await loadResets();
    } catch (err) {
      console.error("Password reset failed:", err);
      S.toast(err.message || "Password reset failed.", "error", 8000);
      button.disabled = false;
    }
  }

  async function dismissReset(button) {
    button.disabled = true;
    try {
      const { data, error } = await supabase
        .from("password_reset_requests")
        .update({ status: "dismissed", handled_by: currentModerator.id, handled_at: new Date().toISOString() })
        .eq("id", button.dataset.resetDismiss)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Not updated. Check your moderator role.");
      await loadResets();
    } catch (err) {
      console.error("Could not dismiss request:", err);
      S.toast(err.message || "Could not dismiss the request.", "error");
      button.disabled = false;
    }
  }

  function showTempPassword({ temp_password: password, phone, full_name: name }) {
    document.getElementById("tempPwModal")?.remove();
    const wa = S.whatsappNumber(phone);
    const text = encodeURIComponent(`Hi ${name || ""}, your temporary ShopSphere password is: ${password}\nSign in with it, then choose your own new password when asked.`);
    const modal = document.createElement("div");
    modal.id = "tempPwModal";
    modal.className = "modal";
    modal.style.cssText = "z-index:3000;background:rgba(0,0,0,.6)";
    modal.innerHTML = `<div class="modal__panel modal__panel--sm">
      <div class="modal__head"><h3>Temporary password ready</h3><button type="button" class="close-x" aria-label="Close">×</button></div>
      <div class="modal__body" style="text-align:center">
        <p style="color:var(--muted)">For <b>${escapeHTML(name || phone || "the user")}</b>. This is shown <b>once</b>. Send it only to the person you verified.</p>
        <div id="tempPwValue" style="font-family:monospace;font-size:1.6rem;font-weight:800;letter-spacing:1px;background:var(--red-soft);border:1px dashed var(--red-line);border-radius:12px;padding:14px;margin:12px 0;user-select:all">${escapeHTML(password)}</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button type="button" class="btn btn--ghost btn--block" id="tempPwCopy"><i class="bi bi-clipboard-fill" aria-hidden="true"></i> <span>Copy password</span></button>
          ${wa ? `<a class="btn btn--green btn--block" target="_blank" rel="noopener" href="https://wa.me/${escapeHTML(wa)}?text=${text}"><i class="bi bi-whatsapp" aria-hidden="true"></i> Send on WhatsApp</a>` : ""}
          <button type="button" class="btn btn--primary btn--block" id="tempPwDone">Done</button>
        </div>
      </div></div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector(".close-x").addEventListener("click", close);
    modal.querySelector("#tempPwDone").addEventListener("click", close);
    modal.querySelector("#tempPwCopy").addEventListener("click", async (event) => {
      try {
        await navigator.clipboard.writeText(password);
        event.currentTarget.querySelector("span").textContent = "Copied!";
      } catch (_) {
        S.toast("Press and hold the password to copy it.", "info", 4000);
      }
    });
    requestAnimationFrame(() => modal.classList.add("open"));
  }

  function wireEvents() {
    $$(".admin-nav [data-view]").forEach((button) =>
      button.addEventListener("click", () => switchView(button.dataset.view))
    );
    $("#btnNewProduct").addEventListener("click", () => openProductEditor());
    $("#productForm").addEventListener("submit", saveProduct);
    $("#btnNewBanner").addEventListener("click", () => openBannerEditor());
    $("#btnSaveMax").addEventListener("click", saveMaxBanners);
    $("#btnAdminChangePw").addEventListener("click", () => S.openChangePasswordModal());
    $("#bannerForm").addEventListener("submit", saveBanner);
    $("#bnImage").addEventListener("change", (event) => {
      $("#bnImagePreview").innerHTML = [...event.target.files]
        .map((file) => `<img src="${URL.createObjectURL(file)}" alt="Selected image" style="width:160px;height:auto">`)
        .join("");
    });
    $("#ordersFilter").addEventListener("input", renderOrdersTable);
    $$("[data-account-tab]").forEach((button) =>
      button.addEventListener("click", () => switchAccountTab(button.dataset.accountTab))
    );
    $$("[data-close-modal]").forEach((button) =>
      button.addEventListener("click", () => {
        $("#" + button.dataset.closeModal).classList.remove("open");
        if (!$(".modal.open")) $("#overlay").classList.remove("open");
      })
    );
    $$(".modal").forEach((modal) =>
      modal.addEventListener("click", (event) => {
        if (event.target !== modal) return;
        modal.classList.remove("open");
        if (!$(".modal.open")) $("#overlay").classList.remove("open");
      })
    );
    $("#pImages").addEventListener("change", (event) => {
      const files = [...event.target.files];
      $("#pImagePreview").innerHTML = files
        .map((file) => `<img src="${URL.createObjectURL(file)}" alt="Selected image">`)
        .join("");
    });
    $("#btnLogout").addEventListener("click", async () => {
      try {
        await S.signOut();
        location.reload();
      } catch (err) {
        S.toast(err.message || "Could not sign out.", "error");
      }
    });
    $("#btnAdminMenu").addEventListener("click", () => {
      $("#adminSide").classList.toggle("open");
      $("#overlay").classList.toggle("open");
    });
    $("#overlay").addEventListener("click", () => {
      $$(".modal.open").forEach((modal) => modal.classList.remove("open"));
      $("#adminSide").classList.remove("open");
      $("#overlay").classList.remove("open");
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentModerator && wired) loadPlatformData();
  });

  document.addEventListener("DOMContentLoaded", initAuth);
})();
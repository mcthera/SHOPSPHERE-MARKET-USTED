(function () {
  "use strict";
  const S = window.Store;
  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  let currentUser = null;
  let myProducts = [];
  let myOrders = [];

  async function init() {
    wireEvents();
    try {
      currentUser = await S.getCurrentUser();
      if (!currentUser || !["seller", "moderator"].includes(currentUser.profile?.role)) {
        $("#sellerAuthGate").classList.remove("hidden");
        return;
      }

      $("#sellerAuthGate").classList.add("hidden");
      $("#sellerShell").classList.remove("hidden");
      const isModerator = currentUser.profile.role === "moderator";
      $("#btnSellerModeratorPanel").classList.toggle("hidden", !isModerator);
      if (isModerator) {
        $("#sellerViewTitle").textContent = "Moderator Access";
        $("#btnNewListing").classList.add("hidden");
        $("#sellerStatusBanner").classList.add("hidden");
        $("#sellerModeratorNotice").classList.remove("hidden");
        ["dashboard", "products", "orders"].forEach((view) =>
          $("#view-" + view).classList.add("hidden")
        );
        $$(".admin-nav [data-view]").forEach((button) => button.classList.add("hidden"));
        return;
      }
      applyApprovalState();
      populateCategories();
      await loadSellerData();
    } catch (err) {
      console.error("Could not load seller account:", err);
      S.toast(err.message || "Could not load seller account.", "error", 7000);
    }
  }

  function applyApprovalState() {
    const status = currentUser.profile.seller_status;
    const approved = status === "approved";
    const banner = $("#sellerStatusBanner");
    banner.classList.toggle("hidden", approved);
    banner.innerHTML = status === "suspended"
      ? "<strong>⛔ Account suspended:</strong> Please contact the moderators to restore your seller access."
      : "<strong style=\"color:#b45309\">⚠️ Account Pending Approval:</strong> Your seller account is under moderator review. You can post listings once approved. This page updates automatically when you return to it.";
    $("#btnNewListing").disabled = !approved;
  }

  // pick up approval / new orders when the seller returns to this tab
  async function refreshSession() {
    if (!currentUser || currentUser.profile?.role !== "seller") return;
    try {
      const fresh = await S.getCurrentUser();
      if (!fresh) return;
      const wasApproved = currentUser.profile.seller_status === "approved";
      currentUser = fresh;
      applyApprovalState();
      await loadSellerData();
      if (!wasApproved && fresh.profile.seller_status === "approved") S.toast("Your seller account was approved! 🎉");
    } catch (err) {
      console.error("Could not refresh seller session:", err);
    }
  }

  function switchView(view) {
    $$(".admin-nav [data-view]").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view)
    );
    ["dashboard", "products", "orders"].forEach((name) =>
      $("#view-" + name).classList.toggle("hidden", name !== view)
    );
    $("#sellerViewTitle").textContent = {
      dashboard: "Seller Dashboard",
      products: "My Listings",
      orders: "Sales & Orders",
    }[view] || "Seller Dashboard";
    $("#sellerSide").classList.remove("open");
    $("#overlay").classList.remove("open");
  }

  async function loadSellerData() {
    try {
      const [products, orders] = await Promise.all([
        S.getProducts({ sellerId: currentUser.id }),
        S.getSellerOrders(),
      ]);
      myProducts = products;
      myOrders = orders;
      renderDashboard();
      renderMyProducts();
      renderSellerOrders();
    } catch (err) {
      console.error("Could not load seller data:", err);
      S.toast(err.message || "Could not load seller listings and orders.", "error", 7000);
    }
  }

  function renderDashboard() {
    const totalEarnings = myOrders.reduce((sum, order) =>
      sum + (order.items || []).reduce((orderTotal, item) =>
        orderTotal + Number(item.price || 0) * Number(item.qty || 1), 0), 0);
    const now = new Date();
    const todaysOrders = myOrders.filter((order) =>
      new Date(order.created_at).toDateString() === now.toDateString()
    );
    const todaysRevenue = todaysOrders.reduce((sum, order) =>
      sum + (order.items || []).reduce((orderTotal, item) =>
        orderTotal + Number(item.price || 0) * Number(item.qty || 0), 0), 0);
    const lowStockCount = myProducts.filter((product) => Number(product.stock) < 3).length;

    $("#sellerStatCards").innerHTML = `
      <div class="stat stat--sales"><div class="stat__icon">💰</div>
        <div class="stat__label">Total Sales</div><div class="stat__value">${S.formatPrice(totalEarnings)}</div></div>
      <div class="stat stat--prod"><div class="stat__icon">📦</div>
        <div class="stat__label">Your Active Listings</div><div class="stat__value">${myProducts.length}</div></div>
      <div class="stat stat--ord"><div class="stat__icon">🧾</div>
        <div class="stat__label">Orders Received</div><div class="stat__value">${myOrders.length}</div></div>
      <div class="stat stat--ord"><div class="stat__icon">📅</div>
        <div class="stat__label">Today's Orders</div><div class="stat__value">${todaysOrders.length}</div></div>
      <div class="stat stat--sales"><div class="stat__icon">💵</div>
        <div class="stat__label">Today's Revenue</div><div class="stat__value">${S.formatPrice(todaysRevenue)}</div></div>
      <div class="stat ${lowStockCount ? "stat--low" : "stat--prod"}"><div class="stat__icon">⚠️</div>
        <div class="stat__label">Low Stock (below 3)</div><div class="stat__value">${lowStockCount}</div></div>`;

    const recent = myProducts.slice(0, 5);
    $("#sellerRecentProducts").innerHTML = recent.length
      ? `<thead><tr><th>Image</th><th>Title</th><th>Price</th><th>Stock</th></tr></thead><tbody>${recent
          .map((product) => `<tr>
            <td>${product.images?.[0] ? `<img src="${escapeHTML(product.images[0])}" alt="">` : "—"}</td>
            <td><strong>${escapeHTML(product.title)}</strong></td>
            <td>${S.formatPrice(product.price)}</td>
            <td>${escapeHTML(product.stock)}${Number(product.stock) < 3 ? ' <span class="badge badge--low">Low stock</span>' : ""}</td>
          </tr>`).join("")}</tbody>`
      : `<tbody><tr><td style="color:var(--muted)">You haven't posted any products yet.</td></tr></tbody>`;
  }

  function renderMyProducts() {
    const table = $("#sellerProductsTable");
    const canManageInventory = currentUser.profile.seller_status === "approved";
    if (!myProducts.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">No products found.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Image</th><th>Title</th><th>Category</th><th>Price</th><th>Inventory</th><th>Actions</th></tr></thead>
      <tbody>${myProducts.map((product) => `<tr>
        <td>${product.images?.[0] ? `<img src="${escapeHTML(product.images[0])}" alt="">` : "—"}</td>
        <td><strong>${escapeHTML(product.title)}</strong>${product.isFeatured ? `<br><span class="badge badge--cat">⭐ Featured until ${escapeHTML(new Date(product.featuredUntil).toLocaleDateString())}</span>` : ""}</td>
        <td>${escapeHTML(product.category)}</td>
        <td>${S.formatPrice(product.price)}</td>
        <td>
          <button type="button" class="btn btn--ghost btn--sm" data-stock-change="-1" data-stock-id="${escapeHTML(product.id)}" aria-label="Decrease stock" ${Number(product.stock) === 0 || !canManageInventory ? "disabled" : ""}>−</button>
          <strong>${escapeHTML(product.stock)}</strong>
          <button type="button" class="btn btn--ghost btn--sm" data-stock-change="1" data-stock-id="${escapeHTML(product.id)}" aria-label="Increase stock" ${!canManageInventory ? "disabled" : ""}>+</button>
          ${Number(product.stock) < 3 ? '<br><span class="badge badge--low">Low stock</span>' : ""}
          <label style="display:block;margin-top:5px"><input type="checkbox" data-stock-toggle="${escapeHTML(product.id)}" ${Number(product.stock) > 0 ? "checked" : ""} ${!canManageInventory ? "disabled" : ""}> In stock</label>
        </td>
        <td><button class="btn btn--ghost btn--sm" data-edit-item="${escapeHTML(product.id)}" ${!canManageInventory ? "disabled" : ""}>✏️ Edit</button> <button class="btn btn--danger btn--sm" data-del-item="${escapeHTML(product.id)}">🗑️ Delete</button></td>
      </tr>`).join("")}</tbody>`;
    $$("[data-edit-item]", table).forEach((button) =>
      button.addEventListener("click", () => openProductModal(button.dataset.editItem))
    );
    $$("[data-del-item]", table).forEach((button) =>
      button.addEventListener("click", () => deleteItem(button.dataset.delItem))
    );
    $$("[data-stock-change]", table).forEach((button) =>
      button.addEventListener("click", () => adjustStock(button.dataset.stockId, Number(button.dataset.stockChange)))
    );
    $$("[data-stock-toggle]", table).forEach((checkbox) =>
      checkbox.addEventListener("change", () => toggleStock(checkbox))
    );
  }

  async function adjustStock(id, delta) {
    const product = myProducts.find((item) => item.id === id);
    if (!product) return;
    await saveStock(id, Math.max(0, Number(product.stock) + delta));
  }

  async function toggleStock(checkbox) {
    const product = myProducts.find((item) => item.id === checkbox.dataset.stockToggle);
    if (!product) return;
    const nextStock = checkbox.checked
      ? Math.max(1, Number(product.stock_before_out) || 1)
      : 0;
    await saveStock(product.id, nextStock, checkbox);
  }

  async function saveStock(id, stock, control) {
    if (control) control.disabled = true;
    try {
      await S.updateSellerStock(id, stock);
      S.toast("Inventory updated.");
      await loadSellerData();
    } catch (err) {
      console.error("Could not update inventory:", err);
      if (control) control.checked = Number(myProducts.find((item) => item.id === id)?.stock) > 0;
      S.toast(err.message || "Could not update inventory.", "error");
    } finally {
      if (control) control.disabled = false;
    }
  }

  function renderSellerOrders() {
    const table = $("#sellerOrdersTable");
    if (!myOrders.length) {
      table.innerHTML = `<tbody><tr><td style="color:var(--muted)">No customer orders yet.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th>Update status</th></tr></thead>
      <tbody>${myOrders.map((order) => `<tr>
        <td><strong>${escapeHTML(order.reference)}</strong></td>
        <td>${escapeHTML(order.customer_name || "Customer")}<br>${escapeHTML(order.customer_phone || "")}<br><small>${escapeHTML(order.customer_address || "")}</small></td>
        <td>${(order.items || []).map((item) => `${escapeHTML(item.title)} (x${escapeHTML(item.qty)})`).join("<br>")}</td>
        <td><span class="status-pill status-${escapeHTML(order.status)}">${escapeHTML(order.status)}</span></td>
        <td><select data-update-status="${escapeHTML(order.id)}"${order.status === "Canceled" ? " disabled" : ""} aria-label="Update status for ${escapeHTML(order.reference)}">
          ${["Pending", "Shipped", "Delivered", "Canceled"].map((status) =>
            `<option value="${status}"${order.status === status ? " selected" : ""}>${status}</option>`
          ).join("")}
        </select></td>
      </tr>`).join("")}</tbody>`;
    $$("[data-update-status]", table).forEach((select) =>
      select.addEventListener("change", () => updateOrderStatus(select))
    );
  }

  async function updateOrderStatus(select) {
    const previousStatus = myOrders.find((order) => order.id === select.dataset.updateStatus)?.status;
    if (select.value === "Canceled" && !confirm("Cancel this order? The items go back into stock and a canceled order cannot be changed again.")) {
      select.value = previousStatus;
      return;
    }
    select.disabled = true;
    try {
      await S.updateOrderStatus(select.dataset.updateStatus, select.value);
      S.toast(select.value === "Canceled" ? "Order canceled and stock restored." : "Order status updated.");
      await loadSellerData();
    } catch (err) {
      console.error("Could not update order status:", err);
      if (previousStatus) select.value = previousStatus;
      S.toast(err.message || "Could not update order status.", "error");
    } finally {
      select.disabled = false;
    }
  }

  function populateCategories() {
    $("#spCategory").innerHTML = S.CATEGORIES
      .map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`)
      .join("");
  }

  function openProductModal(id = "") {
    const product = myProducts.find((item) => item.id === id);
    $("#sellerProductForm").reset();
    $("#spId").value = product?.id || "";
    $("#sellerModalTitle").textContent = product ? "Edit Listing" : "Post Product";
    $("#btnSaveListing").textContent = product ? "💾 Save Changes" : "💾 Save Listing";
    $("#spTitle").value = product?.title || "";
    $("#spCategory").value = product?.category || S.CATEGORIES[0];
    $("#spPrice").value = product?.price ?? "";
    $("#spStock").value = product?.stock ?? 1;
    $("#spDesc").value = product?.description || "";
    $("#spFileInput").required = !product;
    $("#spImageHelp").textContent = product
      ? "Choose replacement images, or leave blank to keep current images."
      : "Choose one or more images for this listing.";
    $("#spImagePreview").innerHTML = (product?.images || [])
      .map((url) => `<img src="${escapeHTML(url)}" alt="Current product image">`)
      .join("");
    $("#sellerProductModal").classList.add("open");
    $("#overlay").classList.add("open");
  }

  async function deleteItem(id) {
    if (!confirm("Delete this listing?")) return;
    try {
      await S.deleteProduct(id);
      S.toast("Listing deleted.");
      await loadSellerData();
    } catch (err) {
      console.error("Could not delete listing:", err);
      S.toast(err.message || "Could not delete listing.", "error");
    }
  }

  async function saveListing(event) {
    event.preventDefault();
    const button = $("#btnSaveListing");
    const id = $("#spId").value;
    const files = [...$("#spFileInput").files];
    if (!id && !files.length) {
      S.toast("Select at least one product photo.", "error");
      return;
    }
    button.disabled = true;
    try {
      const product = {
        title: $("#spTitle").value.trim(),
        category: $("#spCategory").value,
        price: Number($("#spPrice").value),
        stock: Number($("#spStock").value),
        description: $("#spDesc").value.trim(),
        images: myProducts.find((item) => item.id === id)?.images || [],
      };
      if (!product.title) throw new Error("Enter a listing title.");
      if (!Number.isFinite(product.price) || product.price < 0
        || !Number.isInteger(product.stock) || product.stock < 0) {
        throw new Error("Enter a valid price and non-negative whole-number stock.");
      }
      if (id) await S.updateSellerProduct(id, product, files);
      else await S.createProduct(product, files);
      $("#sellerProductForm").reset();
      closeProductModal();
      S.toast(id ? "Listing updated successfully." : "Product listed successfully.");
      await loadSellerData();
    } catch (err) {
      console.error("Could not save product:", err);
      S.toast(err.message || "Could not save product.", "error", 7000);
    } finally {
      button.disabled = false;
    }
  }

  function closeProductModal() {
    $("#sellerProductModal").classList.remove("open");
    $("#overlay").classList.remove("open");
  }

  function wireEvents() {
    $("#sellerLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        if (!$("#sellerLoginUser").value.replace(/[^0-9]/g, "")) throw new Error("Enter a valid WhatsApp number.");
        await S.signIn(S.phoneToEmail($("#sellerLoginUser").value), $("#sellerLoginPass").value);
        const user = await S.getCurrentUser();
        if (user.profile?.role === "moderator") {
          location.href = "admin.html";
          return;
        }
        if (user.profile.role !== "seller") {
          await S.signOut();
          throw new Error("This account is not registered as a seller.");
        }
        location.reload();
      } catch (err) {
        console.error("Seller sign-in failed:", err);
        S.toast(S.friendlyError(err) || "Seller sign-in failed.", "error");
      } finally {
        button.disabled = false;
      }
    });

    $$(".admin-nav [data-view]").forEach((button) =>
      button.addEventListener("click", () => switchView(button.dataset.view))
    );
    $("#btnSellerMenu").addEventListener("click", () => {
      $("#sellerSide").classList.toggle("open");
      $("#overlay").classList.toggle("open");
    });
    $("#overlay").addEventListener("click", () => {
      $("#sellerSide").classList.remove("open");
      closeProductModal();
    });
    $("#btnNewListing").addEventListener("click", () => {
      if (currentUser?.profile?.seller_status !== "approved") {
        S.toast("Awaiting moderator approval before posting products.", "error");
        return;
      }
      openProductModal();
    });
    $("#btnSellerModeratorPanel").addEventListener("click", () => {
      location.href = "admin.html";
    });
    $("#btnSellerModeratorOpen").addEventListener("click", () => {
      location.href = "admin.html";
    });
    $("#sellerProductForm").addEventListener("submit", saveListing);
    $("#spFileInput").addEventListener("change", (event) => {
      $("#spImagePreview").innerHTML = [...event.target.files]
        .map((file) => `<img src="${URL.createObjectURL(file)}" alt="Selected image">`)
        .join("");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshSession();
    });
    $$("[data-close-modal='sellerProductModal']").forEach((button) =>
      button.addEventListener("click", closeProductModal)
    );
    $("#sellerForgotLink").addEventListener("click", (event) => {
      event.preventDefault();
      S.openForgotPasswordModal();
    });
    $("#btnSellerChangePw").addEventListener("click", () => S.openChangePasswordModal());
    $("#btnSellerLogout").addEventListener("click", async () => {
      try {
        await S.signOut();
        location.href = "index.html";
      } catch (err) {
        S.toast(err.message || "Could not sign out.", "error");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();

document.addEventListener("DOMContentLoaded", () => {
	const toggle = document.querySelector(".site-nav__toggle");
	const menu = document.querySelector(".site-nav__menu");

	if (toggle && menu) {
		toggle.addEventListener("click", () => {
			const isOpen = menu.classList.toggle("is-open");
			toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
			document.body.style.overflow = isOpen ? "hidden" : "";
		});

		// cerrar el menú al elegir una opción
		menu.querySelectorAll("a").forEach((link) => {
			link.addEventListener("click", () => {
				menu.classList.remove("is-open");
				toggle.setAttribute("aria-expanded", "false");
				document.body.style.overflow = "";
			});
		});

		// cerrar con Escape
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && menu.classList.contains("is-open")) {
				menu.classList.remove("is-open");
				toggle.setAttribute("aria-expanded", "false");
				document.body.style.overflow = "";
			}
		});
	}

	// marcar automáticamente la página actual como activa
	const current = location.pathname.split("/").pop() || "index.html";
	document.querySelectorAll(".site-nav__menu a").forEach((link) => {
		const href = link.getAttribute("href");
		if (href === current) {
			link.closest("li").classList.add("is-active");
		}
	});
});

(function () {
  "use strict";

  function closeAlertCenters(except) {
    document.querySelectorAll(".ct-alert-center.is-open").forEach(function (center) {
      if (center === except) return;
      center.classList.remove("is-open");
      var trigger = center.querySelector(".ct-alert-trigger");
      var panel = center.querySelector(".ct-alert-panel");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      if (panel) panel.hidden = true;
    });
  }

  function closeHelp(except) {
    document.querySelectorAll(".ct-help.is-open").forEach(function (help) {
      if (help === except) return;
      help.classList.remove("is-open");
      var trigger = help.querySelector(".ct-info-trigger");
      var popover = help.querySelector(".ct-help-popover");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      if (popover) popover.hidden = true;
    });
  }

  function initAlertCenters() {
    document.querySelectorAll(".ct-alert-center").forEach(function (center) {
      if (center.dataset.ctAlertInit === "1") return;
      center.dataset.ctAlertInit = "1";
      var trigger = center.querySelector(".ct-alert-trigger");
      var panel = center.querySelector(".ct-alert-panel");
      var close = center.querySelector(".ct-alert-close");
      if (!trigger || !panel) return;

      function setOpen(open) {
        if (open) {
          closeAlertCenters(center);
          closeHelp();
        }
        center.classList.toggle("is-open", open);
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
        panel.hidden = !open;
      }

      trigger.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(!center.classList.contains("is-open"));
      });
      if (close) {
        close.addEventListener("click", function (event) {
          event.preventDefault();
          setOpen(false);
          trigger.focus();
        });
      }
      center.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.focus();
        }
      });
    });
  }

  function initContextHelp() {
    document.querySelectorAll(".ct-help").forEach(function (help) {
      if (help.dataset.ctHelpInit === "1") return;
      help.dataset.ctHelpInit = "1";
      var trigger = help.querySelector(".ct-info-trigger");
      var popover = help.querySelector(".ct-help-popover");
      if (!trigger || !popover) return;

      function setOpen(open) {
        if (open) {
          closeHelp(help);
          closeAlertCenters();
        }
        help.classList.toggle("is-open", open);
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
        popover.hidden = !open;
      }

      trigger.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var pinned = help.dataset.pinned === "1";
        help.dataset.pinned = pinned ? "0" : "1";
        setOpen(!pinned);
      });
      trigger.addEventListener("mouseenter", function () {
        if (window.matchMedia("(hover: hover)").matches && help.dataset.pinned !== "1") setOpen(true);
      });
      help.addEventListener("mouseleave", function () {
        if (window.matchMedia("(hover: hover)").matches && help.dataset.pinned !== "1" && !trigger.matches(":focus")) setOpen(false);
      });
      help.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.focus();
        }
      });
    });
  }

  function initThemeSwitch() {
    document.querySelectorAll('.ct-theme-switch[data-current-theme="system"]').forEach(function (switcher) {
      var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var effective = dark ? "dark" : "light";
      var choice = switcher.querySelector('[data-theme-choice="' + effective + '"]');
      if (choice) choice.classList.add("is-effective");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initAlertCenters();
    initContextHelp();
    initThemeSwitch();

    document.addEventListener("click", function (event) {
      if (!event.target.closest(".ct-alert-center")) closeAlertCenters();
      if (!event.target.closest(".ct-help")) {
        document.querySelectorAll(".ct-help").forEach(function (help) { help.dataset.pinned = "0"; });
        closeHelp();
      }
    });
    document.addEventListener("constello:content-updated", function () {
      initAlertCenters();
      initContextHelp();
    });
  });
})();

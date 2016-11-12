// ==UserScript==
// @name         PoE Multilive
// @namespace    orlp
// @version      0.1
// @description  Combine multiple PoE live searches
// @author       orlp
// @match        *://poe.trade/
// @require      https://code.jquery.com/jquery-3.1.1.min.js
// @require      https://cdn.jsdelivr.net/clipboard.js/1.5.13/clipboard.min.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';
    
    var Tinycon = unsafeWindow.Tinycon;
    var live_load_settings = unsafeWindow.live_load_settings;
    var live_notify = unsafeWindow.live_notify;
    var update_timers = unsafeWindow.update_timers;
    
    var multilive_active = false;

    $(".form-choose-action .button-group").append('<li><a href="#" id="multilive-btn" class="button tiny secondary" onclick="return false;">Multilive</a></li>');
    $('<div class="custom" id="multilive" style="display: none;"><p>Place poe.trade search URLs in the box below. Any new items will be tracked here.</p><p>Anything not starting with <code>http://poe.trade</code> will be ignored, so you are free to put comments explaining what the URLs are wherever. You can use this also to temporarily disable an URL, by replacing <tt>http://</tt> with <tt>nope://</tt> or similar.</p><textarea style="height: 20em;" id="multilive-urls"></textarea></div>').insertAfter("#search");
    $("#multilive").append('<div class=\"alert-box live-search\">\r\n    Live search running.\r\n    Refresh every <select id=\"live-refresh-frequency\" onchange=\"live_update_settings();\">\r\n        <option value=\"1\">!! HFT MODE !!<\/option>\r\n        <option value=\"5\">5<\/option>\r\n        <option value=\"15\">15<\/option>\r\n        <option value=\"30\" selected=\"selected\">30<\/option>\r\n        <option value=\"60\">60<\/option>\r\n        <option value=\"90\">90<\/option>\r\n    <\/select> seconds.\r\n    <span id=\"live-status\"><\/span>\r\n<\/div>\r\n\r\n<div class=\"alert-box\" id=\"live-notification-settings\">\r\nNotification settings: <label for=\"live-notify-sound\">Notify with sound<\/label> <input onclick=\"live_update_settings()\" type=\"checkbox\" id=\"live-notify-sound\"> | <label for=\"live-notify-browser\">Notify with a browser notification<\/label> <input onclick=\"live_update_settings()\" type=\"checkbox\" id=\"live-notify-browser\">\r\n<a href=\"#\" class=\"right\" onclick=\"live_notify(); return false;\">test notification<\/a>\r\n<audio id=\"live-audio\">\r\n<source src=\"\/static\/notification.mp3\" type=\"audio\/mpeg\">\r\n<\/audio>\r\n<\/div>\r\n<div id="items"></div>');

    var autosave = GM_getValue("urls", '""');
    $("#multilive-urls").val(JSON.parse(autosave));

    var searches, last_id, refresh_num, last_beep, found_ids, time_to_refresh;
    var init_multilive = function() {
        searches = [];
        update_searched();
        last_id = {};
        refresh_num = 0;
        last_beep = -1;
        found_ids = {};
        time_to_refresh = 0;
    };

    // Item count favicon.
    var displayed_item_count = 0;
    var is_focused = true;
    $(window).blur(function() { is_focused = false; });
    $(window).focus(function() {
        is_focused = true;
        displayed_item_count = 0;
        Tinycon.setBubble(0);
    });

    var dispatch_search = function(search, id) {
        return $.post("http://poe.trade/search/" + search + "/live", { "id": id }, function(data) {
            last_id[search] = data.newid;
            var new_data = false;
            if (data.data) {
                new_data = !(last_id[search] in found_ids);
                found_ids[last_id[search]] = 1;
            }

            if (!multilive_active) return;

            if (new_data && last_beep < refresh_num) {
                last_beep = refresh_num;
                live_notify();
                update_timers();
            }
            if (new_data) {
                if (!is_focused) {
                    displayed_item_count += data.count;
                    Tinycon.setBubble(displayed_item_count);
                }
                $("#items").prepend(data.data);
            }
        });
    };

    var last_heartbeat_id = null;
    var do_refresh = function() {
        refresh_num += 1;

        var queries = [];
        for (var i = 0; i < searches.length; ++i) {
            var id;
            if (searches[i] in last_id) {
                id = last_id[searches[i]];
            } else {
                id = -1;
            }

            queries.push(dispatch_search(searches[i], id));
        }

        $.when.apply($, queries).done(function() {
            heartbeat();
        }).fail(function() {
            $("#live-status").text("Backend failed; retrying in 60s, or try refreshing the page.");
            last_heartbeat_id = setTimeout(heartbeat, 60 * 1000);
        });
    };

    var heartbeat = function() {
        last_heartbeat_id = null;
        if (!multilive_active) return;
        if (time_to_refresh <= 0) {
            time_to_refresh = parseInt($("#live-refresh-frequency").val());
            $("#live-status").text("Updating...");
            do_refresh();
        } else {
            $("#live-status").text("Next refresh in: " + time_to_refresh);
            time_to_refresh -= 1;
            last_heartbeat_id = setTimeout(heartbeat, 1000);
        }
    };

    var update_searched = function() {
        var text = $("#multilive-urls").val();
        var urls = /https?:\/\/poe.trade\/search\/([a-z]+)/g;
        var match;
        searches = [];
        while ((match = urls.exec(text))) {
            searches.push(match[1]);
        }

        GM_setValue("urls", JSON.stringify(text));
    };

    $("#multilive-urls").on("change keyup paste", update_searched);

    $("#multilive-btn").click(function() {
        $("#search").hide();
        $("#import").hide();
        $("#multilive").show();
        $("#search-btn").removeClass("active");
        $("#import-btn").removeClass("active");
        $(this).addClass("active");
        multilive_active = true;
        init_multilive();
        heartbeat();
    });

    var hide_multilive = function() {
        $("#multilive").hide();
        $("#multilive-btn").removeClass("active");
        multilive_active = false;
        if (last_heartbeat_id !== null) {
            clearTimeout(last_heartbeat_id);
            last_heartbeat_id = null;
        }
    };

    $("#search-btn").click(hide_multilive);
    $("#import-btn").click(hide_multilive);

    live_load_settings();

    // Fix whisper button.
    var whisperClipboard = new Clipboard(".whisper-btn", {
        text: function(trigger) {
            return whisperMessage(trigger);
        }
    });
    whisperClipboard.on("success", function(e) {
        $(e.trigger).text("Copied to clipboard");
    });
    whisperClipboard.on("error", function(e) {
        sendWhisper(e.trigger);
    });
})();

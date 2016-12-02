// ==UserScript==
// @name         PoE Multilive
// @namespace    orlp
// @version      0.2
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

    var strip_ws_separators = function(str) {
        return str.replace(/[ \t\n:;|\/\\=@#$%^&*-]*$/,"")
            .replace(/^[ \t\n:;|\/\\=@#$%^&*-]*/,"");
    };

    $(".form-choose-action .button-group").append('<li><a href="#" id="multilive-btn" class="button tiny secondary" onclick="return false;">Multilive</a></li>');
    $('<div class="custom" id="multilive" style="display: none;"><p>Place poe.trade search URLs in the box below, <b>one per line</b>. Any new items will be tracked here. It\'s suggested you write a short description on the same line, as this will be displayed on a match. For example:</p><p><pre>4mod essence drain jewel: http://poe.trade/search/abcdefghijklmnop</pre></p><p>Any line not containing <code>http://poe.trade</code> will be ignored, so you are free to put comments explaining what the URLs are wherever. You can use this also to temporarily disable an URL, by replacing <tt>http://</tt> with <tt>nope://</tt> or similar.</p><textarea style="height: 20em;" id="multilive-urls"></textarea><p>Account name blacklist, separated by commas:<input type="text" id="multilive-blacklist"></input></p></div>').insertAfter("#search");
    $("#multilive").append('<div class=\"alert-box live-search\">\r\n    Live search running.\r\n    Refresh every <select id=\"live-refresh-frequency\" onchange=\"live_update_settings();\">\r\n        <option value=\"1\">!! HFT MODE !!<\/option>\r\n        <option value=\"5\">5<\/option>\r\n        <option value=\"15\">15<\/option>\r\n        <option value=\"30\" selected=\"selected\">30<\/option>\r\n        <option value=\"60\">60<\/option>\r\n        <option value=\"90\">90<\/option>\r\n    <\/select> seconds.\r\n    <span id=\"live-status\"><\/span>\r\n<\/div>\r\n\r\n<div class=\"alert-box\" id=\"live-notification-settings\">\r\nNotification settings: <label for=\"live-notify-sound\">Notify with sound<\/label> <input onclick=\"live_update_settings()\" type=\"checkbox\" id=\"live-notify-sound\"> | <label for=\"live-notify-browser\">Notify with a browser notification<\/label> <input onclick=\"live_update_settings()\" type=\"checkbox\" id=\"live-notify-browser\">\r\n<a href=\"#\" class=\"right\" onclick=\"live_notify(); return false;\">test notification<\/a>\r\n<audio id=\"live-audio\">\r\n<source src=\"\/static\/notification.mp3\" type=\"audio\/mpeg\">\r\n<\/audio>\r\n<\/div>\r\n<div id="items"></div>');

    var url_autosave = GM_getValue("urls", '""');
    var blacklist_autosave = GM_getValue("blacklist", '""');
    $("#multilive-urls").val(JSON.parse(url_autosave));
    $("#multilive-blacklist").val(JSON.parse(blacklist_autosave));

    var searches, search_lines, blacklist_accounts, last_id, refresh_num, last_beep, found_ids, time_to_refresh;
    var init_multilive = function() {
        searches = [];
        search_lines = {};
        update_searched();
        blacklist_accounts = [];
        update_blacklist();
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

            var not_ignored_count = data.count;
            if (new_data) {
                var new_html = $.parseHTML(data.data);
                $(new_html).find('tbody.item').each(function(_, item) {
                    item = $(item);
                    var seller = item.attr('data-seller');
                    var description = search_lines[search].replace(/https?:\/\/poe.trade\/search\/([a-z]+)(\/live)?\/?/, "");
                    item.find('.bottom-row .first-cell:empty').text(seller).css("color", "#aaa").css("font-size", "0.8em");
                    var link = $('<a href="http://poe.trade/search/'+search+'" style="color: #aaa" target="_blank"></a>').text(strip_ws_separators(description));
                    item.find('.bottom-row .third-cell:empty').append(link);

                    if (blacklist_accounts.indexOf($.trim(seller)) > -1) {
                        item.hide().remove();
                        not_ignored_count -= 1;
                    }
                });

                if (not_ignored_count > 0) {
                    $("#items").prepend(new_html);
                    $("#items > div").filter(":gt(100)").hide().remove(); // Remove old woops
                }

                if (not_ignored_count > 0 && last_beep < refresh_num) {
                    last_beep = refresh_num;
                    live_notify();
                    update_timers();
                }

                if (!is_focused) {
                    displayed_item_count += not_ignored_count;
                    Tinycon.setBubble(displayed_item_count);
                }
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
        searches = [];
        search_lines = {};
        var lines = text.split(/\r?\n/).forEach(function(line) {
            var search = line.match(/https?:\/\/poe.trade\/search\/([a-z]+)/);
            if (search) {
                searches.push(search[1]);
                search_lines[search[1]] = line;
            }
        });

        GM_setValue("urls", JSON.stringify(text));
    };

    var update_blacklist = function() {
        var blacklist = $("#multilive-blacklist").val();
        blacklist_accounts = [];
        var accounts = blacklist.split(/,/).forEach(function(account) {
            blacklist_accounts.push($.trim(account));
        });
        GM_setValue("blacklist", JSON.stringify(blacklist));
    };

    $("#multilive-urls").on("change keyup paste", update_searched);
    $("#multilive-blacklist").on("change keyup paste", update_blacklist);

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

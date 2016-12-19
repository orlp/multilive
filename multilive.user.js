// ==UserScript==
// @name         PoE Multilive
// @namespace    orlp
// @version      0.8
// @description  Combine multiple PoE live searches
// @author       orlp
// @match        *://poe.trade/
// @require      https://code.jquery.com/jquery-3.1.1.min.js
// @require      https://cdn.jsdelivr.net/clipboard.js/1.5.13/clipboard.min.js
// @require      https://raw.githubusercontent.com/joewalnes/reconnecting-websocket/master/reconnecting-websocket.min.js
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
    $("#multilive").append('<div class=\"alert-box\" id=\"live-notification-settings\">\r\nNotification settings: <label for=\"live-notify-sound\">Notify with sound<\/label> <input onclick=\"live_update_settings()\" type=\"checkbox\" id=\"live-notify-sound\"> | <label for=\"live-notify-browser\">Notify with a browser notification<\/label> <input onclick=\"live_update_settings()\" type=\"checkbox\" id=\"live-notify-browser\"> <span style="padding-left: 2em;">Searches connected: <span id="multilive-connected">0/0</span></span>\r\n<a href=\"#\" class=\"right\" onclick=\"live_notify(); return false;\">test notification<\/a>\r\n<audio id=\"live-audio\">\r\n<source src=\"\/static\/notification.mp3\" type=\"audio\/mpeg\">\r\n<\/audio>\r\n<\/div>\r\n<div id="items" style="min-height: 1000px;"><h2 id="multilive-init-msg"><br>Results will be shown here.<br><br>This page intentionally left blank.</h2></div>');

    var url_autosave = GM_getValue("urls", '""');
    var blacklist_autosave = GM_getValue("blacklist", '""');
    $("#multilive-urls").val(JSON.parse(url_autosave));
    $("#multilive-blacklist").val(JSON.parse(blacklist_autosave));

    var searches, search_lines, blacklist_accounts, last_known_id, last_found_id, currently_searching;
    var init_multilive = function() {
        searches = [];
        search_lines = {};
        last_known_id = {};
        last_found_id = {};
        currently_searching = {};
        blacklist_accounts = [];
        update_searched();
        update_blacklist();

        for (var i = 0; i < searches.length; ++i) dispatch_search(searches[i]);
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

    var dispatch_search = function(search) {
        if (currently_searching[search]) return;

        currently_searching[search] = true;
        $.post("http://poe.trade/search/" + search + "/live", { "id": last_found_id[search] }, function(data) {
            if (!multilive_active) return;

            if (data.data) {
                console.log("found", last_found_id[search], "with data", search, "newid", data.newid);
            } else {
                console.log("found", last_found_id[search], "without data", search, "newid", data.newid);
            }

            last_found_id[search] = data.newid;

            if (data.uniqs && sockets[search].readyState == 1) {
                var uniqs = data.uniqs;
                for (var i = 0; i < uniqs.length; ++i) {
                    sockets[search].send(JSON.stringify({
                        type: "subscribe",
                        value: uniqs[i]
                    }));
                }
            }

            if (data.data) {
                var not_ignored_count = data.count;
                var new_html = $.parseHTML(data.data);
                $(new_html).find('tbody.item').each(function(_, item) {
                    item = $(item);
                    var seller = item.attr('data-seller');
                    var description = search_lines[search].replace(/https?:\/\/poe.trade\/search\/([a-z]+)(\/live)?\/?/, "");
                    var profile = $('<a href="https://www.pathofexile.com/account/view-profile/'+seller+'" style="color: #aaa; font-size: 0.8em;" target="_blank"></a>').text(seller);
                    item.find('.bottom-row .first-cell:empty').append(profile);
                    var link = $('<a href="http://poe.trade/search/'+search+'" style="color: #aaa;" target="_blank"></a>').text(strip_ws_separators(description));
                    item.find('.bottom-row .third-cell:empty').append(link);

                    if (blacklist_accounts.indexOf($.trim(seller)) > -1) {
                        console.log("blacklisted", item, seller);
                        item.hide().remove();
                        not_ignored_count -= 1;
                    }
                });

                if (not_ignored_count > 0) {
                    $("#multilive-init-msg").hide();
                    $("#items").prepend(new_html);
                    $("#items > div").filter(":gt(100)").hide().remove(); // Remove old woops.
                    live_notify();
                }

                if (!is_focused) {
                    displayed_item_count += not_ignored_count;
                    Tinycon.setBubble(displayed_item_count);
                }
            }

            currently_searching[search] = false;
            //if (last_found_id[search] < last_known_id[search]) dispatch_search(search);
        }).fail(function() {
            console.log("error while retrieving data", search);
            currently_searching[search] = false;
            //setTimeout(function() {
            //    if (last_found_id[search] < last_known_id[search]) dispatch_search(search);
            //}, 1000);
        });
    };

    setInterval(function() {
        for (var search in last_found_id) {
            if (last_found_id[search] < last_known_id[search]) dispatch_search(search);
        }
    }, 1000);

    var update_searched = function() {
        var text = $("#multilive-urls").val();
        searches = [];
        search_lines = {};
        var lines = text.split(/\r?\n/).forEach(function(line) {
            var search = line.match(/https?:\/\/poe.trade\/search\/([a-z]+)/);
            if (search) {
                searches.push(search[1]);
                search_lines[search[1]] = line;

                if (!(search[1] in last_known_id)) {
                    last_known_id[search[1]] = -1;
                    last_found_id[search[1]] = -1;
                }
            }
        });

        GM_setValue("urls", JSON.stringify(text));

        update_sockets();
    };

    var sockets = {};

    var update_connected = function() {
        var num_connected = 0;
        for (var search in sockets) {
            if (sockets[search].readyState == 1) num_connected += 1;
        }

        $("#multilive-connected").text(num_connected.toString() + "/" + searches.length.toString());
    };

    var socket_heartbeat = function() {
        for (var search in sockets) {
            if (sockets[search].readyState == 1) sockets[search].send("ping");
        }
    };
    setInterval(socket_heartbeat, 30 * 1000);

    var socket_onopen = function(event) {
        update_connected();
        this.send('{"type": "version", "value": 3}');
    };

    var socket_onmessage = function(event) {
        var msg = $.parseJSON(event.data);
        if (typeof msg == "number") {
            console.log("notify", this.search, last_known_id[this.search], "->", msg);
            last_known_id[this.search] = Math.max(last_known_id[this.search], msg);
            dispatch_search(this.search);
            return;
        }
        switch (msg.type) {
            case "notify":
                console.log("notify", this.search, last_known_id[this.search], "->", msg.value);
                last_known_id[this.search] = Math.max(last_known_id[this.search], msg.value);
                dispatch_search(this.search);
                break;
            case "del":
                $(".item-live-" + msg.value).addClass("item-gone");
                break;
        }
    };

    var socket_onclose = function(event) {
        update_connected();
        var search = this.search;
        setTimeout(function() {
            if (!multilive_active) return;
            create_socket(search);
        }, 1000);
    };

    var create_socket = function(search) {
        var socket = new WebSocket("ws://live.poe.trade/" + search);
        sockets[search] = socket;
        socket.search = search;
        socket.onopen = socket_onopen;
        socket.onmessage = socket_onmessage;
        socket.onclose = socket_onclose;
        socket.onerror = socket_onclose;
    };

    var delete_socket = function(socket) {
        delete sockets[socket.search];
        socket.onclose = function() { }; // Disable handler first.
        socket.onerror = function() { };
        socket.close();
    };

    var update_sockets = function() {
        for (var i = 0; i < searches.length; ++i) {
            if (!(searches[i] in sockets)) create_socket(searches[i]);
        }

        for (var search in sockets) {
            if (searches.indexOf(search) == -1) delete_socket(sockets[search]);
        }

        update_connected();
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

    var show_multilive = function() {
        $("#search").hide();
        $("#import").hide();
        $("#multilive").show();
        $("#search-btn").removeClass("active");
        $("#import-btn").removeClass("active");
        $(this).addClass("active");
        multilive_active = true;
        init_multilive();
    };

    var hide_multilive = function() {
        $("#multilive").hide();
        $("#multilive-btn").removeClass("active");
        multilive_active = false;
        for (var search in sockets) delete_socket(sockets[search]);
    };

    $("#multilive-btn").click(show_multilive);
    $("#search-btn").click(hide_multilive);
    $("#import-btn").click(hide_multilive);

    live_load_settings();

    var info_heartbeat = function() {
        setTimeout(info_heartbeat, 1000);
        if (!multilive_active) return;

        update_timers();
    };
    info_heartbeat();

    // Fix whisper button and make big.
    var whisperClipboard = new Clipboard(".whisper-btn", {
        text: function(trigger) { return whisperMessage(trigger); }
    });
    whisperClipboard.on("success", function(e) {
        $(e.trigger).text("Copied to clipboard");
    });
    whisperClipboard.on("error", function(e) {
        sendWhisper(e.trigger);
    });

    $("<style>.icon-td { cursor: pointer; }</style>").appendTo("head");
    var big_whisper = new Clipboard(".icon-td", {
        text: function(trigger) { return whisperMessage(trigger); }
    });
    big_whisper.on("success", function(e) {
        $(e.trigger).parents(".item").find(".whisper-btn").text("Copied to clipboard");
    });
    big_whisper.on("error", function(e) {
        sendWhisper(e.trigger);
    });
})();

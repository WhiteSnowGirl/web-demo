/**
 * @author: natumsol
 * @description: simulate logining in zhihu.com
 */
var https = require("https");
var cheerio = require('cheerio');
var async = require("async");
var querystring = require("querystring");
var config = require("./config/config");
var mongoose = require("mongoose");
require("./config/mongoose.js")();
var Zhihu = mongoose.model("Zhihu");
var logger = require("./log");
var entities = require("entities");
var fs = require("fs");
var prompt = require('prompt');
var colors = require("colors");
var stream = require("stream");
var url = {
    home: "www.zhihu.com",
    login: "/login/email",
    activities: "/people/${username}/activities",
    people: "/people/${username}"
}
var loginCookie = fs.existsSync(__dirname + '/config/cookie') ? fs.readFileSync(__dirname + '/config/cookie', 'utf8') : null; // store login info
var user = fs.existsSync(__dirname + '/config/userInfo.json') ? require(__dirname + '/config/userInfo.json') : {}; // store user info
var xsrftoken = loginCookie ? loginCookie.match(/_xsrf=([a-zA-Z0-9]+);/)[1] : null; // store xsrf token
var count = 0;
prompt.start();

/* get email and password */
var getEmailAndPassword = function (callback) {
    console.log(colors.green("友情提示：本软件不会保存或上传您的用户名和密码，仅作登录认证之用，请放心使用~\n"))
    prompt.get([{
        name: 'email',
        required: true,
        description: '知乎注册邮箱',
        pattern: /^(\w)+(\.\w+)*@(\w)+((\.\w+)+)$/
    }, {
            name: 'password',
            hidden: true,
            description: '登录密码',
            required: true,
        }], function (err, result) {
            config.email = result.email;
            config.password = result.password;
            callback(err);
        });
}
/* get _xsrf token */
var getToken = function (callback) {
    var options = {
        hostname: url.home,
        path: "/",
        port: 443,
        method: "GET"
    };
    var req = https.request(options, function (res) {
        var data = [];
        res.on('data', function (chunk) {
            data.push(chunk);
        });
        res.on('end', function () {
            data = Buffer.concat(data).toString("utf-8");
            var $ = cheerio.load(data);
            xsrftoken = $("input[name='_xsrf']").val();
            var cookie = res.headers['set-cookie'];
            if ($(".view-signin .captcha").length) { // 如果有验证码，则提示用户手动输入
                https.request({
                    hostname: url.home,
                    path: "/captcha.gif?type=login&r=" + Date.now(),
                    port: 443,
                    method: "GET",
                    headers: {
                        "Cookie": cookie,
                        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.108 Safari/537.36",
                    }
                }, function (res) {
                    var img = fs.createWriteStream("验证码.jpg");
                    res.pipe(img);
                    img.on("finish", function () {
                        console.log("登录需要验证码，请输入根目录下的'验证码.jpg'上所示的验证码：");
                        prompt.get([{
                            name: 'captcha',
                            required: true,
                            description: '请输入验证码',
                            pattern: /[0-9a-zA-Z]{4}/
                        }], function (err, result) {
                            callback(err, {
                                token: xsrftoken,
                                captcha: result['captcha'],
                                cookie: cookie
                            });
                        });
                    })
                }).end();

            }

        })
    });

    req.end();
}

/* do login, get login in cookie */
var login = function (data, callback) {
    var postData = {
        password: config.password,
        remember_me: true,
        email: config.email,
        _xsrf: data.token,
        captcha: data.captcha
    }
    var options = {
        hostname: url.home,
        path: url.login,
        port: 443,
        method: "POST",
        headers: {
            "Cookie": data.cookie,
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.108 Safari/537.36",
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        }
    };

    var req = https.request(options, function (res) {
        loginCookie = res.headers["set-cookie"];
        for (var i = 0; i < loginCookie.length; i++) {
            if (loginCookie[i].indexOf("xsrf") != -1) {
                loginCookie[i] = loginCookie[i].replace("_xsrf=;", "_xsrf=" + xsrftoken + ";");
            }
        }
        fs.writeFile('config/cookie', loginCookie, function (err) {
            if (err) throw err;
        })
        var loginInfo = [];
        res.on('data', function (chunk) {
            loginInfo.push(chunk);
        });
        res.on("end", function () {
            loginInfo = JSON.parse(Buffer.concat(loginInfo));
            if (loginInfo.r == 0) {
                callback(null, loginCookie);
            } else {
                callback("登陆失败！");
            }
        })
    });

    req.write(querystring.stringify(postData));
    req.end();
}

/* get userInfo */
var getUserInfo = function (cookie, callback) {
    var options = {
        hostname: url.home,
        path: "/",
        port: 443,
        method: "GET",
        headers: {
            "Cookie": cookie,
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.108 Safari/537.36"
        }
    };
    var req = https.request(options, function (res) {
        var data = [];
        res.on('data', function (chunk) {
            data.push(chunk);
        });
        res.on('end', function () {
            data = Buffer.concat(data).toString("utf-8");
            var $ = cheerio.load(data);
            user.username = $(".top-nav-profile .name").text();
            fs.writeFile("./config/userInfo.json", JSON.stringify(user), function (err) {
                if (err) throw err;
                else console.log("userInfo save ok!");
            })
            callback(null, user.username);
        })
    });

    req.end();
}

/* get activities data */
var getData = function (start, username) {
    if (start == null) {
        logger.info("爬取完成～");
        process.exit(0);
    }
    var postData = querystring.stringify({
        start: start,
        _xsrf: xsrftoken
    });
    var options = {
        hostname: url.home,
        port: 443,
        path: url.activities.replace("${username}", username),
        method: "POST",
        headers: {
            "Cookie": loginCookie,
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.108 Safari/537.36",
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Content-Length': postData.length
        }
    };
    logger.info("开始爬取第" + (++count) + "波数据...");
    logger.trace("[params: ] " + "start:" + start);
    var req = https.request(options, function (res) {
        var data = [];
        res.on('data', function (chunk) {
            data.push(chunk);
        });
        res.on('end', function () {

            try {
                data = JSON.parse(Buffer.concat(data).toString("utf-8")).msg['1'];
            } catch (e) {
                logger.error("error:" + e.toString());
                process.exit(-1);
            }
            var $ = cheerio.load(data);
            var likeData = [];
            var prefix = "http://www.zhihu.com";
            var member_voteup_answer = $("div.zm-item[data-type-detail='member_voteup_answer']");
            member_voteup_answer.each(function (index, value, array) {
                var zhihu = new Zhihu({
                    date: $(".zm-profile-setion-time", this).text(),
                    question_title: $(".question_link", this).text(),
                    question_link: (prefix + $(".question_link", this).attr("href")).replace(/answer.*$/, ""),
                    author: $(".author-link", this).text(),
                    author_link: prefix + $(".author-link", this).attr("href"),
                    author_avatar: $(".zm-list-avatar", this).attr("src"),
                    vote: $(".zm-item-vote-count", this).text(),
                    answer: entities.decodeHTML($(".zm-item-rich-text .content", this).html())
                        .replace(/\n/g, "").replace(/"/g, "'")
                        .replace(/href='\/\//g, "href='")
                        .replace(/<span\s*class='\s*answer-date-link-wrap\s*'>.*<\/span>\s*$/g, "")
                        .replace(/<br>/g, "\n")
                        .replace(/<img\s*src\s*=\s*'(.+?)'.*>/g, "\n\n![]($1)\n\n")
                        .replace(/-{2,}|\.{2,}/g, ""),
                    answer_link: prefix + $(".zm-item-rich-text", this).attr("data-entry-url"),
                    data_time: Number.parseInt($(this).attr("data-time"))
                });
                likeData.push(zhihu);
            });

            (function (likeData, count) {
                async.map(likeData, function (item, callback) {
                    item.save(function (err) {
                        callback(err);
                    });
                }, function (err, results) {
                    if (err) throw err;
                    else logger.info("第" + count + "波数据爬取完成～");
                })
            })(likeData, count);

            var zm_items = $("div.zm-item");
            var start = $(zm_items[zm_items.length - 1]).attr("data-time");

            setTimeout(function () {
                getData(start, username);
            }, 300 + Math.floor(Math.random() * 200));
        })
    });

    req.write(postData);
    req.end()
}

var getActivities = function (err, username) {
    var options = {
        hostname: url.home,
        path: url.people.replace("${username}", username),
        port: 443,
        method: "GET",
        headers: {
            "Cookie": loginCookie,
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.108 Safari/537.36"

        }
    };
    var req = https.request(options, function (res) {
        var data = [];
        res.on('data', function (chunk) {
            data.push(chunk);
        });
        res.on('end', function () {
            data = Buffer.concat(data).toString("utf-8");
            console.log(data);
            var $ = cheerio.load(data);
            getData($("div.zm-item").eq(0).attr("data-time"), username);
        })
    });

    req.end();
}

/* clean old data */
var cleanOldData = function (callback) {
    Zhihu.find().remove().exec(function (err) {
        callback(err);
    });
}

if (loginCookie) {
    console.log(colors.green("已检测您之前已登陆过，直接登陆..."));
    async.series([cleanOldData], function (err) {
        if (err) throw err;
        else getData(0, user.username);
    });
} else {
    async.series([cleanOldData], function (err) {
        if (err) throw err;
        else async.waterfall([getEmailAndPassword, getToken, login, getUserInfo], getActivities);
    });

}

const assert = require('assert');
const nodemailer = require('nodemailer');
const sinon = require('sinon');
const { sendEmail } = require('../../src/lib/email/email-nodemailer');

describe('Nodemailer SMTP transport', () => {
    const variables = [
        'NODEMAILER_HOST',
        'NODEMAILER_PORT',
        'NODEMAILER_SECURE',
        'NODEMAILER_EMAIL',
        'NODEMAILER_EMAIL_PW',
        'NODEMAILER_AUTH',
        'NODEMAILER_REQUIRE_TLS',
        'SUPPRESS_EMAIL',
    ];
    const message = {
        toAddress: 'recipient@example.com',
        fromName: 'GOST',
        subject: 'Sign-in test',
        body: 'Test message',
        tags: [],
    };
    let previous;
    let sendMail;
    let createTransport;

    beforeEach(() => {
        previous = variables.map((name) => [name, process.env[name]]);
        variables.forEach((name) => { delete process.env[name]; });
        process.env.NODEMAILER_HOST = 'mailpit';
        process.env.NODEMAILER_PORT = '1025';
        process.env.NODEMAILER_SECURE = 'false';
        process.env.NODEMAILER_EMAIL = 'gost@example.com';
        process.env.NODEMAILER_EMAIL_PW = 'test';
        sendMail = sinon.stub().resolves();
        createTransport = sinon.stub(nodemailer, 'createTransport').returns({ sendMail });
    });

    afterEach(() => {
        createTransport.restore();
        previous.forEach(([name, value]) => {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        });
    });

    it('keeps authenticated Mailpit settings by default', async () => {
        await sendEmail(message);
        assert.deepStrictEqual(createTransport.firstCall.args[0], {
            host: 'mailpit',
            port: '1025',
            secure: false,
            requireTLS: false,
            auth: { user: 'gost@example.com', pass: 'test' },
        });
        assert.strictEqual(sendMail.firstCall.args[0].from.address, 'gost@example.com');
    });

    it('uses the approved sender and requires STARTTLS without SMTP authentication', async () => {
        process.env.NODEMAILER_HOST = 'smtp.fau.edu';
        process.env.NODEMAILER_PORT = '25';
        process.env.NODEMAILER_EMAIL = 'noreply-gost@fau.edu';
        process.env.NODEMAILER_AUTH = 'false';
        process.env.NODEMAILER_REQUIRE_TLS = 'true';
        delete process.env.NODEMAILER_EMAIL_PW;

        await sendEmail(message);

        assert.deepStrictEqual(createTransport.firstCall.args[0], {
            host: 'smtp.fau.edu',
            port: '25',
            secure: false,
            requireTLS: true,
        });
        assert.strictEqual(sendMail.firstCall.args[0].from.address, 'noreply-gost@fau.edu');
    });

    it('requires a password when SMTP authentication is enabled', async () => {
        delete process.env.NODEMAILER_EMAIL_PW;
        await assert.rejects(sendEmail(message), /Missing environment variable NODEMAILER_EMAIL_PW/);
        sinon.assert.notCalled(createTransport);
    });
});

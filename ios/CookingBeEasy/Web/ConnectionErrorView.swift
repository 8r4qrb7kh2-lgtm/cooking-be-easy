import UIKit

/// Shown when the site can't be reached at all. Without it a failed first load
/// leaves nothing but a blank screen and no way back.
final class ConnectionErrorView: UIView {
    private let retry: () -> Void

    init(retry: @escaping () -> Void) {
        self.retry = retry
        super.init(frame: .zero)

        backgroundColor = UIColor(named: "LaunchBackground")

        let title = UILabel()
        title.text = "Can't reach the kitchen"
        title.font = .preferredFont(forTextStyle: .headline)
        title.textAlignment = .center

        let detail = UILabel()
        detail.text = "Cooking be easy needs a connection to load your recipes."
        detail.font = .preferredFont(forTextStyle: .subheadline)
        detail.textColor = .secondaryLabel
        detail.textAlignment = .center
        detail.numberOfLines = 0

        var configuration = UIButton.Configuration.filled()
        configuration.title = "Try again"
        configuration.baseBackgroundColor = UIColor(named: "Brand")
        configuration.cornerStyle = .large
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: 12, leading: 24, bottom: 12, trailing: 24
        )

        let button = UIButton(
            configuration: configuration,
            primaryAction: UIAction { [weak self] _ in self?.retry() }
        )

        let stack = UIStackView(arrangedSubviews: [title, detail, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.setCustomSpacing(24, after: detail)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -32),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}
